-- HR-CHAT-002: route HR work/request events into the configured HR chat room.

create table if not exists public.chat_hr_delivery_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  room_id uuid references public.chat_rooms(id) on delete set null,
  source_table text not null,
  source_id uuid not null,
  event_key text not null,
  event_type text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  chat_message_id uuid references public.chat_messages(id) on delete set null,
  message_text text,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, event_key)
);

create index if not exists chat_hr_delivery_status_idx
  on public.chat_hr_delivery_events(company_id, status, next_retry_at, created_at);
create index if not exists chat_hr_delivery_source_idx
  on public.chat_hr_delivery_events(source_table, source_id, event_type);

drop trigger if exists chat_hr_delivery_touch_updated_at
  on public.chat_hr_delivery_events;
create trigger chat_hr_delivery_touch_updated_at
before update on public.chat_hr_delivery_events
for each row execute function public.touch_chat_attendance_integration_updated_at();

alter table public.chat_hr_delivery_events enable row level security;

drop policy if exists "Managers read HR chat delivery" on public.chat_hr_delivery_events;
create policy "Managers read HR chat delivery"
on public.chat_hr_delivery_events for select to authenticated
using (
  company_id = public.current_company_id()
  and public.is_company_manager(company_id)
);

revoke insert, update, delete on public.chat_hr_delivery_events from anon, authenticated;
grant select on public.chat_hr_delivery_events to authenticated;

create or replace function public.format_hr_chat_status(status_value text)
returns text
language sql
stable
set search_path = public
as $$
  select case coalesce(status_value, '')
    when 'pending' then 'รอดำเนินการ'
    when 'late_notice' then 'แจ้งย้อนหลัง/รอตรวจ'
    when 'needs_evidence' then 'รอเอกสารเพิ่ม'
    when 'needs_information' then 'รอข้อมูลเพิ่ม'
    when 'approved' then 'อนุมัติแล้ว'
    when 'rejected' then 'ไม่อนุมัติ'
    when 'cancelled' then 'ยกเลิก'
    when 'used' then 'ใช้งานแล้ว'
    when 'assigned' then 'มอบหมายแล้ว'
    when 'acknowledged' then 'รับทราบแล้ว'
    when 'pending_approval' then 'รออนุมัติ'
    when 'generating' then 'กำลังสร้างเอกสาร'
    when 'ready' then 'พร้อมส่ง'
    when 'delivered' then 'ส่งแล้ว'
    when 'received' then 'รับแล้ว'
    when 'expired' then 'หมดอายุ'
    when 'failed' then 'ล้มเหลว'
    when 'open' then 'เปิดเคส'
    when 'in_progress' then 'กำลังดำเนินการ'
    when 'blocked' then 'ติดปัญหา'
    when 'completed' then 'เสร็จแล้ว'
    when 'draft' then 'ฉบับร่าง'
    when 'notice' then 'แจ้งลาออกล่วงหน้า'
    when 'terminated' then 'สิ้นสภาพแล้ว'
    when 'pending_resignation' then 'รอตัดสิทธิ์ตามวันมีผล'
    when 'effective_resignation' then 'มีผลแล้ว'
    else coalesce(nullif(status_value, ''), '-')
  end;
$$;

create or replace function public.deliver_hr_work_chat_event(
  target_company_id uuid,
  target_source_table text,
  target_source_id uuid,
  target_event_key text,
  target_event_type text,
  target_title text,
  target_lines jsonb default '[]'::jsonb,
  target_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  integration_row record;
  delivery_row record;
  line_value text;
  message_value text;
begin
  if target_company_id is null
    or target_source_table is null
    or target_source_id is null
    or nullif(trim(target_event_key), '') is null
    or nullif(trim(target_event_type), '') is null
    or nullif(trim(target_title), '') is null then
    return;
  end if;

  select integration.id, integration.room_id
  into integration_row
  from public.chat_room_integrations integration
  join public.chat_rooms room
    on room.id = integration.room_id
   and room.company_id = integration.company_id
  where integration.company_id = target_company_id
    and integration.integration_key = 'attendance'
    and integration.enabled = true
  limit 1;

  if integration_row.id is null then
    return;
  end if;

  message_value := '📌 ' || trim(target_title);
  for line_value in
    select value
    from jsonb_array_elements_text(coalesce(target_lines, '[]'::jsonb)) as value
  loop
    if nullif(trim(line_value), '') is not null then
      message_value := message_value || E'\n' || trim(line_value);
    end if;
  end loop;
  message_value := message_value
    || E'\nรหัสอ้างอิง: ' || target_source_id::text
    || E'\nหมวด: ' || target_event_type;

  insert into public.chat_hr_delivery_events(
    company_id, room_id, source_table, source_id, event_key, event_type,
    status, attempt_count, message_text, payload, next_retry_at
  ) values (
    target_company_id, integration_row.room_id, target_source_table, target_source_id,
    trim(target_event_key), trim(target_event_type), 'pending', 1,
    message_value, coalesce(target_payload, '{}'::jsonb), null
  )
  on conflict (company_id, event_key) do update set
    room_id = excluded.room_id,
    message_text = excluded.message_text,
    payload = excluded.payload,
    attempt_count = case
      when public.chat_hr_delivery_events.status = 'sent'
        then public.chat_hr_delivery_events.attempt_count
      else public.chat_hr_delivery_events.attempt_count + 1
    end,
    status = case
      when public.chat_hr_delivery_events.status = 'sent'
        then 'sent'
      else 'pending'
    end,
    error_message = case
      when public.chat_hr_delivery_events.status = 'sent'
        then public.chat_hr_delivery_events.error_message
      else null
    end,
    next_retry_at = null,
    updated_at = now()
  returning id, status, room_id, chat_message_id into delivery_row;

  if delivery_row.status = 'sent' then
    return;
  end if;

  begin
    insert into public.chat_messages(
      company_id, room_id, sender_profile_id, message_type, text_content
    ) values (
      target_company_id, integration_row.room_id, null, 'text', message_value
    )
    returning id into delivery_row.chat_message_id;

    update public.chat_hr_delivery_events
    set status = 'sent',
        chat_message_id = delivery_row.chat_message_id,
        error_message = null,
        next_retry_at = null,
        updated_at = now()
    where id = delivery_row.id;

    update public.chat_rooms
    set updated_at = now()
    where id = integration_row.room_id
      and company_id = target_company_id;
  exception when others then
    update public.chat_hr_delivery_events
    set status = 'failed',
        error_message = left(sqlerrm, 1000),
        next_retry_at = now() + interval '5 minutes',
        updated_at = now()
    where id = delivery_row.id;
  end;
end;
$$;

create or replace function public.retry_failed_hr_chat_deliveries(
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
    select company_id, source_table, source_id, event_key, event_type, message_text, payload
    from public.chat_hr_delivery_events
    where company_id = target_company_id
      and status = 'failed'
      and (next_retry_at is null or next_retry_at <= now())
    order by updated_at asc
    limit greatest(1, least(coalesce(max_rows, 50), 500))
  loop
    perform public.deliver_hr_work_chat_event(
      delivery.company_id,
      delivery.source_table,
      delivery.source_id,
      delivery.event_key,
      delivery.event_type,
      split_part(coalesce(delivery.message_text, 'งาน HR'), E'\n', 1),
      '[]'::jsonb,
      delivery.payload
    );
    retried := retried + 1;
  end loop;
  return retried;
end;
$$;

create or replace function public.publish_leave_request_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  leave_name text;
  event_name text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  select coalesce(type.name_th, type.code, '-') into leave_name
  from public.leave_types type
  where type.id = new.leave_type_id;

  event_name := case when tg_op = 'INSERT' then 'leave_created' else 'leave_' || new.status end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'employee_leave_requests',
    new.id,
    new.id::text || ':' || event_name,
    event_name,
    'รายการงาน HR: คำขอลา',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'ประเภท: ' || coalesce(leave_name, '-'),
      'ช่วงเวลา: ' || to_char(new.starts_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' - ' || to_char(new.ends_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
      'สถานะ: ' || public.format_hr_chat_status(new.status),
      'รายละเอียด: เปิดดูในหน้างาน HR ตามสิทธิ์'
    ),
    jsonb_build_object('source_table','employee_leave_requests','source_id',new.id,'profile_id',new.profile_id,'status',new.status)
  );
  return new;
end;
$$;

create or replace function public.publish_attendance_correction_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  event_name text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  event_name := case when tg_op = 'INSERT' then 'time_correction_created' else 'time_correction_' || new.status end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'attendance_correction_requests',
    new.id,
    new.id::text || ':' || event_name,
    event_name,
    'รายการแจ้งเวลา: ขอแก้ไขเวลา',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'เวลาเข้าใหม่: ' || coalesce(to_char(new.requested_clock_in_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'), '-'),
      'เวลาออกใหม่: ' || coalesce(to_char(new.requested_clock_out_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'), '-'),
      'สถานะ: ' || public.format_hr_chat_status(new.status),
      'รายละเอียด: เปิดดูในหน้างาน HR ตามสิทธิ์'
    ),
    jsonb_build_object('source_table','attendance_correction_requests','source_id',new.id,'profile_id',new.profile_id,'status',new.status,'session_id',new.session_id)
  );
  return new;
end;
$$;

create or replace function public.publish_overtime_assignment_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  site_name text;
  event_name text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  select coalesce(site.name, '-') into site_name
  from public.project_sites site
  where site.id = new.site_id;

  event_name := case when tg_op = 'INSERT' then 'overtime_created' else 'overtime_' || new.status end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'employee_overtime_assignments',
    new.id,
    new.id::text || ':' || event_name,
    event_name,
    'รายการงาน HR: มอบหมาย/อนุมัติ OT',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'ไซต์: ' || coalesce(site_name, '-'),
      'ช่วงเวลา: ' || to_char(new.starts_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') || ' - ' || to_char(new.ends_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'),
      'สถานะ: ' || public.format_hr_chat_status(new.status),
      'รายละเอียด: เปิดดูในหน้างาน HR ตามสิทธิ์'
    ),
    jsonb_build_object('source_table','employee_overtime_assignments','source_id',new.id,'profile_id',new.profile_id,'status',new.status,'site_id',new.site_id)
  );
  return new;
end;
$$;

create or replace function public.publish_document_request_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  event_name text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  event_name := case when tg_op = 'INSERT' then 'document_request_created' else 'document_request_' || new.status end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'employee_document_requests',
    new.id,
    new.id::text || ':' || event_name,
    event_name,
    'รายการงาน HR: ขอเอกสารพนักงาน',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'เอกสาร: ' || coalesce(new.document_type, '-'),
      'ช่องทางขอ: ' || coalesce(new.request_channel, '-'),
      'ช่องทางส่ง: ' || coalesce(new.delivery_channel, '-'),
      'สถานะ: ' || public.format_hr_chat_status(new.status),
      'รายละเอียด: เปิดดูในหน้างาน HR ตามสิทธิ์'
    ),
    jsonb_build_object('source_table','employee_document_requests','source_id',new.id,'profile_id',new.profile_id,'document_type',new.document_type,'status',new.status)
  );
  return new;
end;
$$;

create or replace function public.publish_lifecycle_case_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  event_name text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  event_name := case when tg_op = 'INSERT' then 'lifecycle_case_created' else 'lifecycle_case_' || new.status end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'employee_lifecycle_cases',
    new.id,
    new.id::text || ':' || event_name,
    event_name,
    'รายการงาน HR: เคสพนักงาน',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'ประเภทเคส: ' || coalesce(new.case_type, '-'),
      'วันที่มีผล: ' || coalesce(to_char(new.effective_on, 'DD/MM/YYYY'), '-'),
      'สถานะ: ' || public.format_hr_chat_status(new.status),
      'รายละเอียด: เปิดดูในหน้างาน HR ตามสิทธิ์'
    ),
    jsonb_build_object('source_table','employee_lifecycle_cases','source_id',new.id,'profile_id',new.profile_id,'case_type',new.case_type,'status',new.status)
  );
  return new;
end;
$$;

create or replace function public.publish_resignation_to_hr_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  employee_name text;
  event_name text;
  status_value text;
begin
  if new.resignation_status is null
    or new.resignation_status = 'none'
    or (tg_op = 'UPDATE' and old.resignation_status is not distinct from new.resignation_status) then
    return new;
  end if;

  select coalesce(nullif(trim(profile.full_name), ''), nullif(trim(profile.email), ''), new.profile_id::text)
    into employee_name
  from public.profiles profile
  where profile.id = new.profile_id;

  event_name := 'resignation_' || new.resignation_status;
  status_value := case new.resignation_status
    when 'pending' then 'pending_resignation'
    when 'effective' then 'effective_resignation'
    else new.resignation_status
  end;

  perform public.deliver_hr_work_chat_event(
    new.company_id,
    'employee_employment_records',
    new.profile_id,
    new.company_id::text || ':' || new.profile_id::text || ':' || event_name || ':' || coalesce(new.status_effective_on::text, '-'),
    event_name,
    'รายการแจ้งออก: แจ้งลาออกพนักงาน',
    jsonb_build_array(
      'พนักงาน: ' || coalesce(employee_name, '-'),
      'วันสุดท้ายที่ทำงาน: ' || coalesce(to_char(new.last_working_on, 'DD/MM/YYYY'), '-'),
      'วันที่ตัดสิทธิ์: ' || coalesce(to_char(new.status_effective_on, 'DD/MM/YYYY'), '-'),
      'คิดเงินถึงวันที่: ' || coalesce(to_char(new.payroll_eligible_until, 'DD/MM/YYYY'), '-'),
      'สถานะ: ' || public.format_hr_chat_status(status_value)
    ),
    jsonb_build_object('source_table','employee_employment_records','profile_id',new.profile_id,'company_id',new.company_id,'resignation_status',new.resignation_status)
  );
  return new;
end;
$$;

drop trigger if exists publish_leave_request_to_hr_chat_trigger
  on public.employee_leave_requests;
create trigger publish_leave_request_to_hr_chat_trigger
after insert or update of status on public.employee_leave_requests
for each row execute function public.publish_leave_request_to_hr_chat();

drop trigger if exists publish_attendance_correction_to_hr_chat_trigger
  on public.attendance_correction_requests;
create trigger publish_attendance_correction_to_hr_chat_trigger
after insert or update of status on public.attendance_correction_requests
for each row execute function public.publish_attendance_correction_to_hr_chat();

drop trigger if exists publish_overtime_assignment_to_hr_chat_trigger
  on public.employee_overtime_assignments;
create trigger publish_overtime_assignment_to_hr_chat_trigger
after insert or update of status on public.employee_overtime_assignments
for each row execute function public.publish_overtime_assignment_to_hr_chat();

drop trigger if exists publish_document_request_to_hr_chat_trigger
  on public.employee_document_requests;
create trigger publish_document_request_to_hr_chat_trigger
after insert or update of status on public.employee_document_requests
for each row execute function public.publish_document_request_to_hr_chat();

drop trigger if exists publish_lifecycle_case_to_hr_chat_trigger
  on public.employee_lifecycle_cases;
create trigger publish_lifecycle_case_to_hr_chat_trigger
after insert or update of status on public.employee_lifecycle_cases
for each row execute function public.publish_lifecycle_case_to_hr_chat();

drop trigger if exists publish_resignation_to_hr_chat_trigger
  on public.employee_employment_records;
create trigger publish_resignation_to_hr_chat_trigger
after update of resignation_status, last_working_on, status_effective_on, payroll_eligible_until
on public.employee_employment_records
for each row execute function public.publish_resignation_to_hr_chat();

revoke all on function public.format_hr_chat_status(text) from public, anon, authenticated;
grant execute on function public.format_hr_chat_status(text) to authenticated, service_role;
revoke all on function public.deliver_hr_work_chat_event(uuid, text, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.retry_failed_hr_chat_deliveries(uuid, integer) from public, anon, authenticated;
grant execute on function public.retry_failed_hr_chat_deliveries(uuid, integer) to service_role;
revoke all on function public.publish_leave_request_to_hr_chat() from public, anon, authenticated;
revoke all on function public.publish_attendance_correction_to_hr_chat() from public, anon, authenticated;
revoke all on function public.publish_overtime_assignment_to_hr_chat() from public, anon, authenticated;
revoke all on function public.publish_document_request_to_hr_chat() from public, anon, authenticated;
revoke all on function public.publish_lifecycle_case_to_hr_chat() from public, anon, authenticated;
revoke all on function public.publish_resignation_to_hr_chat() from public, anon, authenticated;

comment on table public.chat_hr_delivery_events is
  'Idempotent delivery ledger for HR request/case/resignation events posted into the configured HR Web Chat room.';
comment on function public.deliver_hr_work_chat_event(uuid, text, uuid, text, text, text, jsonb, jsonb) is
  'Internal HR chat event delivery function. Uses the existing attendance integration room as the HR room destination.';
