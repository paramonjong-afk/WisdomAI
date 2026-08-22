-- OMNI-INTAKE-001: LINE and Web Chat as configurable Intake/OutTake with
-- conversation summary, Filter queue projection, and cross-channel dedupe.

create table if not exists public.omni_channel_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  route_key text not null,
  source_channel text not null check (source_channel in ('line','web_chat','upload','manual','any')),
  sender_scope text not null default 'any' check (sender_scope in ('internal','external','any')),
  default_intake_enabled boolean not null default true,
  default_outtake_channel text not null default 'web_chat' check (default_outtake_channel in ('web_chat','line','queue_only','none')),
  target_department text check (target_department in ('accounting','procurement','inventory','hr','project','admin','system')),
  target_project_id uuid references public.projects(id) on delete set null,
  target_chat_room_id uuid references public.chat_rooms(id) on delete set null,
  target_line_group_id text references public.line_groups(line_group_id) on delete set null,
  summary_only boolean not null default true,
  priority integer not null default 100 check (priority between 1 and 1000),
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, route_key)
);

create table if not exists public.omni_intake_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_channel text not null check (source_channel in ('line','web_chat','upload','manual')),
  source_kind text not null default 'message' check (source_kind in ('message','file','system_event','manual')),
  line_message_id uuid references public.line_messages(id) on delete cascade,
  chat_message_id uuid references public.chat_messages(id) on delete cascade,
  source_room_id text,
  source_room_name text,
  source_sender_id text,
  source_sender_name text,
  occurred_at timestamptz not null,
  text_content text,
  attachment_count integer not null default 0 check (attachment_count >= 0),
  attachment_fingerprint text,
  content_fingerprint text not null,
  dedupe_status text not null default 'primary' check (dedupe_status in ('primary','duplicate','possible_duplicate','context')),
  primary_source_id uuid references public.omni_intake_sources(id) on delete set null,
  conversation_type text not null default 'unknown' check (conversation_type in ('document','hr','accounting','project','procurement','inventory','system_error','question','context','unknown')),
  intent text,
  ai_summary text,
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  confidence_band text not null default 'needs_review' check (confidence_band in ('auto','review','needs_review')),
  suggested_departments text[] not null default '{}',
  suggested_project_id uuid references public.projects(id) on delete set null,
  filter_status text not null default 'queued' check (filter_status in ('queued','confirmed','needs_review','returned','duplicate','dismissed')),
  outtake_status text not null default 'not_ready' check (outtake_status in ('not_ready','ready','sent','failed','suppressed')),
  analysis_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (source_channel = 'line' and line_message_id is not null)
    or (source_channel = 'web_chat' and chat_message_id is not null)
    or source_channel in ('upload','manual')
  )
);

create unique index if not exists omni_intake_sources_line_message_key
  on public.omni_intake_sources(line_message_id);
create unique index if not exists omni_intake_sources_chat_message_key
  on public.omni_intake_sources(chat_message_id);
create index if not exists omni_intake_sources_scope_idx
  on public.omni_intake_sources(company_id, source_channel, occurred_at desc);
create index if not exists omni_intake_sources_filter_idx
  on public.omni_intake_sources(company_id, filter_status, conversation_type, occurred_at desc);
create index if not exists omni_intake_sources_fingerprint_idx
  on public.omni_intake_sources(company_id, content_fingerprint, occurred_at desc);

create table if not exists public.omni_filter_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.omni_intake_sources(id) on delete cascade,
  department text not null check (department in ('accounting','procurement','inventory','hr','project','admin','system')),
  task_status text not null default 'queued' check (task_status in ('queued','claimed','confirmed','returned','cancelled','completed')),
  required boolean not null default true,
  assigned_to uuid references public.profiles(id) on delete set null,
  note text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, department)
);
create index if not exists omni_filter_tasks_queue_idx
  on public.omni_filter_tasks(company_id, department, task_status, updated_at desc);

create table if not exists public.omni_outtake_delivery_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.omni_intake_sources(id) on delete cascade,
  route_id uuid references public.omni_channel_routes(id) on delete set null,
  destination_channel text not null check (destination_channel in ('web_chat','line','queue_only','none')),
  destination_ref text,
  event_key text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','suppressed')),
  message_text text,
  error_message text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, event_key)
);
create index if not exists omni_outtake_delivery_status_idx
  on public.omni_outtake_delivery_events(company_id, status, created_at desc);

create or replace function public.touch_omni_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists omni_channel_routes_touch_updated_at on public.omni_channel_routes;
create trigger omni_channel_routes_touch_updated_at before update on public.omni_channel_routes
for each row execute function public.touch_omni_updated_at();
drop trigger if exists omni_intake_sources_touch_updated_at on public.omni_intake_sources;
create trigger omni_intake_sources_touch_updated_at before update on public.omni_intake_sources
for each row execute function public.touch_omni_updated_at();
drop trigger if exists omni_filter_tasks_touch_updated_at on public.omni_filter_tasks;
create trigger omni_filter_tasks_touch_updated_at before update on public.omni_filter_tasks
for each row execute function public.touch_omni_updated_at();
drop trigger if exists omni_outtake_delivery_touch_updated_at on public.omni_outtake_delivery_events;
create trigger omni_outtake_delivery_touch_updated_at before update on public.omni_outtake_delivery_events
for each row execute function public.touch_omni_updated_at();

alter table public.omni_channel_routes enable row level security;
alter table public.omni_intake_sources enable row level security;
alter table public.omni_filter_tasks enable row level security;
alter table public.omni_outtake_delivery_events enable row level security;

create policy "Managers read omni routes" on public.omni_channel_routes
for select to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Managers manage omni routes" on public.omni_channel_routes
for all to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id))
with check (company_id=public.current_company_id() and public.is_company_manager(company_id));

create policy "Managers read omni intake" on public.omni_intake_sources
for select to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Managers update omni intake" on public.omni_intake_sources
for update to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id))
with check (company_id=public.current_company_id() and public.is_company_manager(company_id));

create policy "Department members read omni filter tasks" on public.omni_filter_tasks
for select to authenticated using (
  company_id=public.current_company_id()
  and (public.is_company_manager(company_id) or public.is_document_flow_department_member(company_id, department))
);
create policy "Managers manage omni filter tasks" on public.omni_filter_tasks
for all to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id))
with check (company_id=public.current_company_id() and public.is_company_manager(company_id));

create policy "Managers read omni outtake delivery" on public.omni_outtake_delivery_events
for select to authenticated using (company_id=public.current_company_id() and public.is_company_manager(company_id));

revoke insert, update, delete on public.omni_intake_sources from anon, authenticated;
revoke insert, update, delete on public.omni_outtake_delivery_events from anon, authenticated;
grant select on public.omni_channel_routes, public.omni_intake_sources, public.omni_filter_tasks, public.omni_outtake_delivery_events to authenticated;
grant insert, update, delete on public.omni_channel_routes, public.omni_filter_tasks to authenticated;

create or replace function public.omni_normalized_fingerprint(
  target_text text,
  target_attachment_fingerprint text default null
)
returns text language sql immutable set search_path = public as $$
  select md5(
    coalesce(nullif(lower(regexp_replace(btrim(coalesce(target_text,'')), '\s+', ' ', 'g')), ''), '-')
    || '|'
    || coalesce(nullif(target_attachment_fingerprint,''), '-')
  );
$$;

create or replace function public.omni_analyze_conversation(
  target_company_id uuid,
  target_text text,
  target_attachment_count integer default 0,
  target_room_name text default null
)
returns table(
  conversation_type text,
  intent text,
  ai_summary text,
  confidence numeric,
  confidence_band text,
  suggested_departments text[],
  suggested_project_id uuid
)
language plpgsql
stable
set search_path = public
as $$
declare
  normalized text := lower(coalesce(target_text,'') || ' ' || coalesce(target_room_name,''));
  project_match uuid;
  departments text[] := '{}';
  ctype text := 'unknown';
  cintent text := 'unknown';
  cconfidence numeric := 0.45;
begin
  select p.id into project_match
  from public.projects p
  where p.company_id = target_company_id
    and p.status <> 'archived'
    and normalized like '%' || lower(p.name) || '%'
  order by length(p.name) desc
  limit 1;

  if target_attachment_count > 0 or normalized ~ '(สลิป|โอนเงิน|ใบเสร็จ|บิล|invoice|receipt|tax|ใบกำกับ|ใบส่งของ|po|quotation)' then
    ctype := 'document';
    cintent := case
      when normalized ~ '(สลิป|โอนเงิน)' then 'submit_transfer_slip'
      when normalized ~ '(ใบส่งของ|รับของ)' then 'submit_delivery_note'
      when normalized ~ '(po|ใบสั่งซื้อ)' then 'submit_purchase_order'
      else 'submit_document'
    end;
    departments := array['accounting'];
    if normalized ~ '(ค่าแรง|ช่าง|พนักงาน)' then departments := array['accounting','hr']; end if;
    cconfidence := case when target_attachment_count > 0 then 0.86 else 0.76 end;
  elsif normalized ~ '(ลาออก|เลิกจ้าง|ออกจากงาน)' then
    ctype := 'hr'; cintent := 'notify_resignation'; departments := array['hr']; cconfidence := 0.88;
  elsif normalized ~ '(เข้างาน|ออกงาน|ลงเวลา|แก้เวลา|สาย|ขาด|ลา)' then
    ctype := 'hr'; cintent := 'hr_time_or_leave'; departments := array['hr']; cconfidence := 0.82;
  elsif normalized ~ '(ซื้อ|สั่งของ|วัสดุ|ราคา|ผู้ขาย|supplier)' then
    ctype := 'procurement'; cintent := 'procurement_request'; departments := array['procurement']; cconfidence := 0.78;
  elsif normalized ~ '(สต็อก|คลัง|รับสินค้า|ของเข้า|ของออก)' then
    ctype := 'inventory'; cintent := 'inventory_update'; departments := array['inventory']; cconfidence := 0.78;
  elsif normalized ~ '(error|เออเรอร์|ผิดพลาด|เข้าไม่ได้|บันทึกไม่ได้|ระบบ)' then
    ctype := 'system_error'; cintent := 'report_system_problem'; departments := array['system']; cconfidence := 0.80;
  elsif normalized ~ '(โครงการ|ไซต์|งาน|บ้าน)' or project_match is not null then
    ctype := 'project'; cintent := 'project_update'; departments := array['project']; cconfidence := 0.70;
  elsif normalized ~ '(ไหม|มั้ย|หรือ|อย่างไร|ยังไง|ถาม)' then
    ctype := 'question'; cintent := 'ask_question'; departments := array['admin']; cconfidence := 0.62;
  end if;

  if cardinality(departments)=0 then departments := array['admin']; end if;

  return query select
    ctype,
    cintent,
    left(coalesce(nullif(btrim(target_text),''),'ข้อความ/ไฟล์จาก ' || coalesce(target_room_name,'ไม่ระบุห้อง')), 240),
    cconfidence,
    case when cconfidence >= 0.90 then 'auto' when cconfidence >= 0.70 then 'review' else 'needs_review' end,
    departments,
    project_match;
end;
$$;

create or replace function public.omni_register_source(
  target_company_id uuid,
  target_source_channel text,
  target_source_kind text,
  target_line_message_id uuid,
  target_chat_message_id uuid,
  target_source_room_id text,
  target_source_room_name text,
  target_source_sender_id text,
  target_source_sender_name text,
  target_occurred_at timestamptz,
  target_text_content text,
  target_attachment_count integer default 0,
  target_attachment_fingerprint text default null
)
returns public.omni_intake_sources
language plpgsql
security definer
set search_path = public
as $$
declare
  analysis record;
  existing_primary public.omni_intake_sources;
  result public.omni_intake_sources;
  fingerprint text;
  dedupe text := 'primary';
  primary_id uuid := null;
  department_name text;
begin
  if target_company_id is null or target_source_channel not in ('line','web_chat','upload','manual') then
    raise exception 'omni_source_invalid';
  end if;

  fingerprint := public.omni_normalized_fingerprint(target_text_content, target_attachment_fingerprint);
  select * into analysis
  from public.omni_analyze_conversation(target_company_id, target_text_content, target_attachment_count, target_source_room_name)
  limit 1;

  select * into existing_primary
  from public.omni_intake_sources source
  where source.company_id = target_company_id
    and source.content_fingerprint = fingerprint
    and source.dedupe_status = 'primary'
    and source.occurred_at between target_occurred_at - interval '2 days' and target_occurred_at + interval '2 days'
  order by source.occurred_at asc
  limit 1;

  if existing_primary.id is not null then
    dedupe := case when existing_primary.source_channel <> target_source_channel then 'duplicate' else 'possible_duplicate' end;
    primary_id := existing_primary.id;
  end if;

  if target_line_message_id is not null then
    insert into public.omni_intake_sources(
      company_id, source_channel, source_kind, line_message_id, chat_message_id,
      source_room_id, source_room_name, source_sender_id, source_sender_name,
      occurred_at, text_content, attachment_count, attachment_fingerprint,
      content_fingerprint, dedupe_status, primary_source_id,
      conversation_type, intent, ai_summary, confidence, confidence_band,
      suggested_departments, suggested_project_id, filter_status, outtake_status,
      analysis_payload
    ) values (
      target_company_id, target_source_channel, coalesce(target_source_kind,'message'), target_line_message_id, target_chat_message_id,
      target_source_room_id, target_source_room_name, target_source_sender_id, target_source_sender_name,
      target_occurred_at, target_text_content, coalesce(target_attachment_count,0), target_attachment_fingerprint,
      fingerprint, dedupe, primary_id,
      analysis.conversation_type, analysis.intent, analysis.ai_summary, analysis.confidence, analysis.confidence_band,
      analysis.suggested_departments, analysis.suggested_project_id,
      case when dedupe='primary' then 'queued' else 'duplicate' end,
      case when dedupe='primary' then 'not_ready' else 'suppressed' end,
      jsonb_build_object('analyzer','rule_based_v1','source_channel',target_source_channel,'confidence_band',analysis.confidence_band)
    )
    on conflict(line_message_id) do update set
      text_content=excluded.text_content,
      attachment_count=excluded.attachment_count,
      attachment_fingerprint=excluded.attachment_fingerprint,
      content_fingerprint=excluded.content_fingerprint,
      dedupe_status=excluded.dedupe_status,
      primary_source_id=excluded.primary_source_id,
      conversation_type=excluded.conversation_type,
      intent=excluded.intent,
      ai_summary=excluded.ai_summary,
      confidence=excluded.confidence,
      confidence_band=excluded.confidence_band,
      suggested_departments=excluded.suggested_departments,
      suggested_project_id=excluded.suggested_project_id,
      analysis_payload=excluded.analysis_payload,
      updated_at=now()
    returning * into result;
  elsif target_chat_message_id is not null then
    insert into public.omni_intake_sources(
      company_id, source_channel, source_kind, line_message_id, chat_message_id,
      source_room_id, source_room_name, source_sender_id, source_sender_name,
      occurred_at, text_content, attachment_count, attachment_fingerprint,
      content_fingerprint, dedupe_status, primary_source_id,
      conversation_type, intent, ai_summary, confidence, confidence_band,
      suggested_departments, suggested_project_id, filter_status, outtake_status,
      analysis_payload
    ) values (
      target_company_id, target_source_channel, coalesce(target_source_kind,'message'), null, target_chat_message_id,
      target_source_room_id, target_source_room_name, target_source_sender_id, target_source_sender_name,
      target_occurred_at, target_text_content, coalesce(target_attachment_count,0), target_attachment_fingerprint,
      fingerprint, dedupe, primary_id,
      analysis.conversation_type, analysis.intent, analysis.ai_summary, analysis.confidence, analysis.confidence_band,
      analysis.suggested_departments, analysis.suggested_project_id,
      case when dedupe='primary' then 'queued' else 'duplicate' end,
      case when dedupe='primary' then 'not_ready' else 'suppressed' end,
      jsonb_build_object('analyzer','rule_based_v1','source_channel',target_source_channel,'confidence_band',analysis.confidence_band)
    )
    on conflict(chat_message_id) do update set
      text_content=excluded.text_content,
      attachment_count=excluded.attachment_count,
      attachment_fingerprint=excluded.attachment_fingerprint,
      content_fingerprint=excluded.content_fingerprint,
      dedupe_status=excluded.dedupe_status,
      primary_source_id=excluded.primary_source_id,
      conversation_type=excluded.conversation_type,
      intent=excluded.intent,
      ai_summary=excluded.ai_summary,
      confidence=excluded.confidence,
      confidence_band=excluded.confidence_band,
      suggested_departments=excluded.suggested_departments,
      suggested_project_id=excluded.suggested_project_id,
      analysis_payload=excluded.analysis_payload,
      updated_at=now()
    returning * into result;
  else
    insert into public.omni_intake_sources(
      company_id, source_channel, source_kind, line_message_id, chat_message_id,
      source_room_id, source_room_name, source_sender_id, source_sender_name,
      occurred_at, text_content, attachment_count, attachment_fingerprint,
      content_fingerprint, dedupe_status, primary_source_id,
      conversation_type, intent, ai_summary, confidence, confidence_band,
      suggested_departments, suggested_project_id, filter_status, outtake_status,
      analysis_payload
    ) values (
      target_company_id, target_source_channel, coalesce(target_source_kind,'message'), null, null,
      target_source_room_id, target_source_room_name, target_source_sender_id, target_source_sender_name,
      target_occurred_at, target_text_content, coalesce(target_attachment_count,0), target_attachment_fingerprint,
      fingerprint, dedupe, primary_id,
      analysis.conversation_type, analysis.intent, analysis.ai_summary, analysis.confidence, analysis.confidence_band,
      analysis.suggested_departments, analysis.suggested_project_id,
      case when dedupe='primary' then 'queued' else 'duplicate' end,
      case when dedupe='primary' then 'not_ready' else 'suppressed' end,
      jsonb_build_object('analyzer','rule_based_v1','source_channel',target_source_channel,'confidence_band',analysis.confidence_band)
    )
    returning * into result;
  end if;

  if result.dedupe_status = 'primary' then
    foreach department_name in array result.suggested_departments loop
      if department_name = any(array['accounting','procurement','inventory','hr','project','admin','system']) then
        insert into public.omni_filter_tasks(company_id, source_id, department, required, task_status)
        values(result.company_id, result.id, department_name, true, 'queued')
        on conflict(source_id, department) do nothing;
      end if;
    end loop;
  end if;

  return result;
end;
$$;

create or replace function public.omni_register_line_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  group_row record;
  sender_row record;
  attachment_count integer := 0;
  attachment_fp text;
  target_company uuid;
begin
  select g.company_id, g.display_name, g.line_group_id into group_row
  from public.line_groups g
  where g.line_group_id = new.line_group_id
  limit 1;
  target_company := coalesce(new.company_id, group_row.company_id);
  if target_company is null then return new; end if;

  select s.display_name into sender_row
  from public.line_senders s
  where s.line_user_id = new.line_user_id
  limit 1;

  select count(*), md5(coalesce(string_agg(storage_path || ':' || coalesce(size_bytes::text,'-'), '|' order by storage_path), '-'))
  into attachment_count, attachment_fp
  from public.line_attachments
  where message_id = new.id;

  perform public.omni_register_source(
    target_company, 'line', case when attachment_count > 0 then 'file' else 'message' end,
    new.id, null,
    new.line_group_id, group_row.display_name,
    new.line_user_id, sender_row.display_name,
    new.occurred_at,
    coalesce(new.text_content, new.file_name, ''),
    attachment_count,
    attachment_fp
  );
  return new;
exception when others then
  raise warning 'omni line source sync failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

create or replace function public.omni_register_chat_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row record;
  sender_row record;
begin
  if new.sender_profile_id is null or new.deleted_at is not null then
    return new;
  end if;
  select r.name into room_row from public.chat_rooms r where r.id = new.room_id and r.company_id = new.company_id limit 1;
  select coalesce(nullif(trim(p.full_name),''), p.email, p.id::text) as display_name into sender_row
  from public.profiles p where p.id = new.sender_profile_id limit 1;

  perform public.omni_register_source(
    new.company_id, 'web_chat', case when new.attachment_path is not null then 'file' else 'message' end,
    null, new.id,
    new.room_id::text, room_row.name,
    new.sender_profile_id::text, sender_row.display_name,
    new.created_at,
    coalesce(new.text_content, new.attachment_name, ''),
    case when new.attachment_path is not null then 1 else 0 end,
    case when new.attachment_path is not null then md5(new.attachment_bucket || ':' || new.attachment_path || ':' || coalesce(new.attachment_size::text,'-')) else null end
  );
  return new;
exception when others then
  raise warning 'omni chat source sync failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists omni_register_line_message_after_insert on public.line_messages;
create trigger omni_register_line_message_after_insert
after insert or update of text_content, file_name, message_type on public.line_messages
for each row execute function public.omni_register_line_message_trigger();

drop trigger if exists omni_register_chat_message_after_insert on public.chat_messages;
create trigger omni_register_chat_message_after_insert
after insert or update of text_content, attachment_path, deleted_at on public.chat_messages
for each row execute function public.omni_register_chat_message_trigger();

create or replace function public.omni_backfill_recent_sources(
  target_company_id uuid,
  max_rows integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  row_count integer := 0;
  line_row public.line_messages;
  chat_row public.chat_messages;
  group_row record;
  sender_row record;
  attachment_count integer;
  attachment_fp text;
begin
  if auth.uid() is not null and not public.is_company_manager(target_company_id) then
    raise exception 'company_manager_required';
  end if;

  for line_row in
    select m.*
    from public.line_messages m
    join public.line_groups g on g.line_group_id = m.line_group_id
    where coalesce(m.company_id, g.company_id) = target_company_id
    order by m.occurred_at desc
    limit greatest(1, least(coalesce(max_rows,500), 5000))
  loop
    select g.company_id, g.display_name, g.line_group_id into group_row
    from public.line_groups g
    where g.line_group_id = line_row.line_group_id
    limit 1;

    select s.display_name into sender_row
    from public.line_senders s
    where s.line_user_id = line_row.line_user_id
    limit 1;

    select count(*), md5(coalesce(string_agg(storage_path || ':' || coalesce(size_bytes::text,'-'), '|' order by storage_path), '-'))
    into attachment_count, attachment_fp
    from public.line_attachments
    where message_id = line_row.id;

    perform public.omni_register_source(
      target_company_id, 'line', case when attachment_count > 0 then 'file' else 'message' end,
      line_row.id, null,
      line_row.line_group_id, group_row.display_name,
      line_row.line_user_id, sender_row.display_name,
      line_row.occurred_at,
      coalesce(line_row.text_content, line_row.file_name, ''),
      attachment_count,
      attachment_fp
    );
    row_count := row_count + 1;
  end loop;

  for chat_row in
    select *
    from public.chat_messages
    where company_id = target_company_id
      and sender_profile_id is not null
    order by created_at desc
    limit greatest(1, least(coalesce(max_rows,500), 5000))
  loop
    perform public.omni_register_source(
      chat_row.company_id, 'web_chat', case when chat_row.attachment_path is not null then 'file' else 'message' end,
      null, chat_row.id, chat_row.room_id::text, null, chat_row.sender_profile_id::text, null, chat_row.created_at,
      coalesce(chat_row.text_content, chat_row.attachment_name, ''),
      case when chat_row.attachment_path is not null then 1 else 0 end,
      case when chat_row.attachment_path is not null then md5(chat_row.attachment_bucket || ':' || chat_row.attachment_path || ':' || coalesce(chat_row.attachment_size::text,'-')) else null end
    );
    row_count := row_count + 1;
  end loop;
  return row_count;
end;
$$;

revoke all on function public.omni_register_source(uuid,text,text,uuid,uuid,text,text,text,text,timestamptz,text,integer,text) from public, anon, authenticated;
revoke all on function public.omni_register_line_message_trigger() from public, anon, authenticated;
revoke all on function public.omni_register_chat_message_trigger() from public, anon, authenticated;
revoke all on function public.omni_backfill_recent_sources(uuid, integer) from public, anon, authenticated;
grant execute on function public.omni_backfill_recent_sources(uuid, integer) to authenticated, service_role;
grant execute on function public.omni_analyze_conversation(uuid,text,integer,text) to authenticated, service_role;

comment on table public.omni_intake_sources is
  'Central registry for LINE/Web Chat/manual Intake messages. Stores rule-based conversation summary, filter queue state, and cross-channel dedupe decision.';
comment on table public.omni_channel_routes is
  'Company-scoped config deciding which channels can be Intake/OutTake and whether outbound messages are Web Chat, LINE, queue-only, or suppressed.';
