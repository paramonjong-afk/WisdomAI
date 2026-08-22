-- CHAT-ATTENDANCE-001: route attendance session events into a company chat room.
create table if not exists public.chat_room_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_key text not null check (integration_key in ('attendance')),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, integration_key)
);

create index if not exists chat_room_integrations_room_idx
  on public.chat_room_integrations(room_id, enabled);

create table if not exists public.chat_attendance_delivery_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  attendance_session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  room_id uuid references public.chat_rooms(id) on delete set null,
  event_key text not null,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  chat_message_id uuid references public.chat_messages(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, event_key)
);

create index if not exists chat_attendance_delivery_status_idx
  on public.chat_attendance_delivery_events(company_id, status, next_retry_at, created_at);
create index if not exists chat_attendance_delivery_session_idx
  on public.chat_attendance_delivery_events(attendance_session_id, event_type);

create or replace function public.touch_chat_attendance_integration_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists chat_room_integrations_touch_updated_at
  on public.chat_room_integrations;
create trigger chat_room_integrations_touch_updated_at
before update on public.chat_room_integrations
for each row execute function public.touch_chat_attendance_integration_updated_at();

drop trigger if exists chat_attendance_delivery_touch_updated_at
  on public.chat_attendance_delivery_events;
create trigger chat_attendance_delivery_touch_updated_at
before update on public.chat_attendance_delivery_events
for each row execute function public.touch_chat_attendance_integration_updated_at();

alter table public.chat_room_integrations enable row level security;
alter table public.chat_attendance_delivery_events enable row level security;

drop policy if exists "Managers or room owners read chat integrations" on public.chat_room_integrations;
create policy "Managers or room owners read chat integrations"
on public.chat_room_integrations for select to authenticated
using (
  company_id = public.current_company_id()
  and (
    public.is_company_manager(company_id)
    or public.is_chat_room_owner(room_id)
  )
);

drop policy if exists "Managers or room owners manage chat integrations" on public.chat_room_integrations;
create policy "Managers or room owners manage chat integrations"
on public.chat_room_integrations for all to authenticated
using (
  company_id = public.current_company_id()
  and (
    public.is_company_manager(company_id)
    or public.is_chat_room_owner(room_id)
  )
)
with check (
  company_id = public.current_company_id()
  and exists (
    select 1 from public.chat_rooms room
    where room.id = room_id
      and room.company_id = company_id
  )
  and (
    public.is_company_manager(company_id)
    or public.is_chat_room_owner(room_id)
  )
);

drop policy if exists "Managers read attendance chat delivery" on public.chat_attendance_delivery_events;
create policy "Managers read attendance chat delivery"
on public.chat_attendance_delivery_events for select to authenticated
using (
  company_id = public.current_company_id()
  and public.is_company_manager(company_id)
);

revoke insert, update, delete on public.chat_attendance_delivery_events from anon, authenticated;
grant select, insert, update, delete on public.chat_room_integrations to authenticated;
grant select on public.chat_attendance_delivery_events to authenticated;

create or replace function public.deliver_attendance_chat_event(
  target_session_id uuid,
  target_event_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row record;
  integration_row record;
  delivery_row record;
  event_key_value text;
  message_value text;
  employee_name text;
  project_name text;
  site_name text;
  event_at timestamptz;
  status_label text;
begin
  if target_event_type not in ('clock_in', 'clock_out') then
    return;
  end if;

  select
    session.id,
    session.company_id,
    session.profile_id,
    session.site_id,
    session.clock_in_at,
    session.clock_out_at,
    session.status,
    coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), session.profile_id::text) as employee_name,
    coalesce(project.name, '-') as project_name,
    coalesce(site.name, '-') as site_name
  into session_row
  from public.attendance_sessions session
  join public.profiles profile on profile.id = session.profile_id
  join public.project_sites site on site.id = session.site_id and site.company_id = session.company_id
  left join public.projects project on project.id = site.project_id
  where session.id = target_session_id;

  if session_row.id is null then
    return;
  end if;

  select integration.id, integration.room_id
  into integration_row
  from public.chat_room_integrations integration
  join public.chat_rooms room
    on room.id = integration.room_id
   and room.company_id = integration.company_id
  where integration.company_id = session_row.company_id
    and integration.integration_key = 'attendance'
    and integration.enabled = true
  limit 1;

  if integration_row.id is null then
    return;
  end if;

  event_key_value := target_session_id::text || ':' || target_event_type;
  event_at := case when target_event_type = 'clock_in' then session_row.clock_in_at else session_row.clock_out_at end;
  if event_at is null then
    return;
  end if;

  insert into public.chat_attendance_delivery_events(
    company_id, attendance_session_id, room_id, event_key, event_type,
    status, attempt_count, payload, next_retry_at
  ) values (
    session_row.company_id, target_session_id, integration_row.room_id, event_key_value,
    target_event_type, 'pending', 1,
    jsonb_build_object(
      'attendance_session_id', target_session_id,
      'event_type', target_event_type,
      'employee_name', session_row.employee_name,
      'project_name', session_row.project_name,
      'site_name', session_row.site_name,
      'event_at', event_at
    ),
    null
  )
  on conflict (company_id, event_key) do update set
    room_id = excluded.room_id,
    payload = excluded.payload,
    attempt_count = case
      when public.chat_attendance_delivery_events.status = 'sent'
        then public.chat_attendance_delivery_events.attempt_count
      else public.chat_attendance_delivery_events.attempt_count + 1
    end,
    status = case
      when public.chat_attendance_delivery_events.status = 'sent'
        then 'sent'
      else 'pending'
    end,
    error_message = case
      when public.chat_attendance_delivery_events.status = 'sent'
        then public.chat_attendance_delivery_events.error_message
      else null
    end,
    next_retry_at = null,
    updated_at = now()
  returning id, status, room_id, chat_message_id into delivery_row;

  if delivery_row.status = 'sent' then
    return;
  end if;

  status_label := case session_row.status
    when 'needs_review' then 'รอตรวจสอบ'
    when 'approved' then 'อนุมัติแล้ว'
    when 'rejected' then 'ไม่รับรายการ'
    else session_row.status
  end;
  message_value := case target_event_type
    when 'clock_in' then '🟢 ลงเวลาเข้า'
    else '🔴 ลงเวลาออก'
  end || E'\nช่าง: ' || session_row.employee_name
    || E'\nโครงการ: ' || session_row.project_name
    || E'\nไซต์: ' || session_row.site_name
    || E'\nเวลา: ' || to_char(event_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI')
    || E'\nสถานะ: ' || status_label
    || E'\nรหัสรายการ: ' || target_session_id::text;

  begin
    insert into public.chat_messages(
      company_id, room_id, sender_profile_id, message_type, text_content
    ) values (
      session_row.company_id, integration_row.room_id, null, 'text', message_value
    )
    returning id into delivery_row.chat_message_id;

    update public.chat_attendance_delivery_events
    set status = 'sent', chat_message_id = delivery_row.chat_message_id,
        error_message = null, next_retry_at = null, updated_at = now()
    where id = delivery_row.id;

    update public.chat_rooms
    set updated_at = now()
    where id = integration_row.room_id
      and company_id = session_row.company_id;
  exception when others then
    update public.chat_attendance_delivery_events
    set status = 'failed', error_message = left(sqlerrm, 1000),
        next_retry_at = now() + interval '5 minutes', updated_at = now()
    where id = delivery_row.id;
  end;
end;
$$;

create or replace function public.publish_attendance_session_to_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.deliver_attendance_chat_event(new.id, 'clock_in');
  elsif tg_op = 'UPDATE'
    and old.clock_out_at is null
    and new.clock_out_at is not null then
    perform public.deliver_attendance_chat_event(new.id, 'clock_out');
  end if;
  return new;
end;
$$;

drop trigger if exists publish_attendance_session_to_chat_trigger
  on public.attendance_sessions;
create trigger publish_attendance_session_to_chat_trigger
after insert or update of clock_out_at on public.attendance_sessions
for each row execute function public.publish_attendance_session_to_chat();

create or replace function public.retry_failed_attendance_chat_deliveries(
  target_company_id uuid,
  max_rows integer default 50
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery record;
  retried integer := 0;
begin
  if auth.uid() is not null and not public.is_company_manager(target_company_id) then
    raise exception 'company_manager_required';
  end if;

  for delivery in
    select attendance_session_id, event_type
    from public.chat_attendance_delivery_events
    where company_id = target_company_id
      and status = 'failed'
      and (next_retry_at is null or next_retry_at <= now())
    order by updated_at asc
    limit greatest(1, least(coalesce(max_rows, 50), 500))
  loop
    perform public.deliver_attendance_chat_event(delivery.attendance_session_id, delivery.event_type);
    retried := retried + 1;
  end loop;
  return retried;
end;
$$;

revoke all on function public.deliver_attendance_chat_event(uuid, text) from public, anon, authenticated;
revoke all on function public.publish_attendance_session_to_chat() from public, anon, authenticated;
revoke all on function public.retry_failed_attendance_chat_deliveries(uuid, integer) from public, anon, authenticated;
grant execute on function public.retry_failed_attendance_chat_deliveries(uuid, integer) to service_role;

comment on table public.chat_room_integrations is
  'Company-scoped destinations for system integrations such as HR attendance logs.';
comment on table public.chat_attendance_delivery_events is
  'Idempotent delivery ledger for attendance events posted into Web Chat.';
