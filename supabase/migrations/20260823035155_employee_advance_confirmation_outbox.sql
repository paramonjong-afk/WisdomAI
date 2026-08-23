-- Durable Web Chat confirmation for employee/technician advances.
-- The advance case remains the financial source of truth. This table is only
-- an idempotent notification projection with an explicit retry ledger.

alter table public.employee_advance_cases
  add column if not exists confirmation_delivery_status text not null default 'not_required'
    check (confirmation_delivery_status in ('not_required','queued','sent','delivered','pending_retry')),
  add column if not exists confirmation_delivery_error text,
  add column if not exists confirmation_delivery_updated_at timestamptz;
alter table public.employee_advance_cases
  add column if not exists confirmation_room_setup_status text not null default 'pending_room_setup'
    check (confirmation_room_setup_status in ('pending_room_setup','ready','failed')),
  add column if not exists confirmation_room_setup_error text;

alter table public.chat_rooms add column if not exists room_key text;
create unique index if not exists chat_rooms_company_room_key_idx
  on public.chat_rooms(company_id,room_key) where room_key is not null;
update public.chat_rooms set room_key='finance_primary'
where room_key is null and lower(name) similar to '%(finance|การเงิน|บัญชี)%'
  and not exists(select 1 from public.chat_rooms other where other.company_id=chat_rooms.company_id and other.room_key='finance_primary');
update public.chat_rooms set room_key='hr_primary'
where room_key is null and lower(name) similar to '%(hr|บุคคล|ทรัพยากร)%'
  and not exists(select 1 from public.chat_rooms other where other.company_id=chat_rooms.company_id and other.room_key='hr_primary');

alter table public.chat_messages
  add column if not exists message_class text not null default 'user_message'
    check (message_class in ('user_message','system_confirmation'));

alter table public.chat_rooms
  add column if not exists room_key text
    check (room_key is null or room_key in ('hr_primary','finance_primary','source_room','program_development_primary','general_work_primary'));
alter table public.chat_rooms
  drop constraint if exists chat_rooms_room_key_check;
alter table public.chat_rooms
  add constraint chat_rooms_room_key_check
  check (room_key is null or room_key in ('hr_primary','finance_primary','source_room','program_development_primary','general_work_primary'));
create unique index if not exists chat_rooms_company_room_key_unique
  on public.chat_rooms(company_id,room_key) where room_key is not null;

-- The existing integration registry only accepted attendance. Advance
-- confirmations use the same room/membership model with their own key.
alter table public.chat_room_integrations
  drop constraint if exists chat_room_integrations_integration_key_check;
alter table public.chat_room_integrations
  add constraint chat_room_integrations_integration_key_check
  check (integration_key in ('attendance','advance_confirmation'));

create table if not exists public.employee_advance_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  advance_case_id uuid not null references public.employee_advance_cases(id) on delete cascade,
  document_id uuid references public.document_flow_items(id) on delete set null,
  message_kind text not null check (message_kind in ('advance_confirm')),
  channel text not null default 'web_chat' check (channel in ('web_chat','system','line','telegram')),
  room_id uuid references public.chat_rooms(id) on delete set null,
  recipient_profile_id uuid references public.profiles(id) on delete set null,
  recipient_kind text not null default 'finance_primary'
    check (recipient_kind in ('source_room','finance_primary','hr_primary','hr_copied')),
  recipient_scope text[] not null default '{}',
  message_text text not null,
  message_class text not null default 'system_confirmation'
    check (message_class = 'system_confirmation'),
  is_system boolean not null default true,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','pending_room_setup','room_setup_failed')),
  retry_count integer not null default 0 check (retry_count >= 0),
  -- attempts is retained as a compatibility alias for the first outbox draft.
  attempts integer not null default 0 check (attempts >= 0),
  chat_message_id uuid references public.chat_messages(id) on delete set null,
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  next_retry_at timestamptz,
  -- event_key is the same Advance event for every destination. delivery_key
  -- is the destination-specific idempotency key.
  event_key text not null,
  delivery_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the draft migration was ever applied manually, remove its one-row-per-case
-- uniqueness so Finance and HR can have independent delivery ledgers.
alter table public.employee_advance_message_deliveries
  drop constraint if exists employee_advance_message_deliveries_advance_case_id_message_kind_key;
alter table public.employee_advance_message_deliveries
  drop constraint if exists employee_advance_message_deliveries_event_key_key;
alter table public.employee_advance_message_deliveries
  drop constraint if exists employee_advance_message_deliveries_status_check;
alter table public.employee_advance_message_deliveries
  add constraint employee_advance_message_deliveries_status_check
  check (status in ('queued','sent','delivered','failed','pending_room_setup','room_setup_failed'));
alter table public.employee_advance_message_deliveries
  add column if not exists recipient_kind text not null default 'finance_primary',
  add column if not exists recipient_scope text[] not null default '{}',
  add column if not exists message_class text not null default 'system_confirmation',
  add column if not exists room_id uuid references public.chat_rooms(id) on delete set null,
  add column if not exists recipient_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists chat_message_id uuid references public.chat_messages(id) on delete set null,
  add column if not exists delivered_at timestamptz,
  add column if not exists retry_count integer not null default 0,
  add column if not exists delivery_key text;
alter table public.employee_advance_message_deliveries
  drop constraint if exists employee_advance_message_deliveries_recipient_kind_check;
alter table public.employee_advance_message_deliveries
  add constraint employee_advance_message_deliveries_recipient_kind_check
  check (recipient_kind in ('source_room','finance_primary','hr_primary','hr_copied'));
update public.employee_advance_message_deliveries
set delivery_key=coalesce(delivery_key,event_key||':'||coalesce(recipient_kind,'finance_primary')||':'||id::text)
where delivery_key is null;
alter table public.employee_advance_message_deliveries
  alter column delivery_key set not null;
create unique index if not exists employee_advance_message_delivery_key_idx
  on public.employee_advance_message_deliveries(delivery_key);

create index if not exists employee_advance_message_delivery_retry_idx
  on public.employee_advance_message_deliveries(status,next_retry_at,updated_at);
create index if not exists employee_advance_message_delivery_case_idx
  on public.employee_advance_message_deliveries(advance_case_id,created_at desc);
create index if not exists employee_advance_message_delivery_room_idx
  on public.employee_advance_message_deliveries(room_id,status,created_at desc);

alter table public.employee_advance_message_deliveries enable row level security;
drop policy if exists "Company managers read advance confirmations" on public.employee_advance_message_deliveries;
create policy "Company managers read advance confirmations"
on public.employee_advance_message_deliveries for select to authenticated
using (public.is_company_manager(company_id));
revoke insert,update,delete on public.employee_advance_message_deliveries from anon,authenticated;
grant select on public.employee_advance_message_deliveries to authenticated;

create or replace function public.refresh_employee_advance_confirmation_status(target_case_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare next_status text;
begin
  select case
    when exists(select 1 from public.employee_advance_message_deliveries d where d.advance_case_id=target_case_id and d.status in ('failed','pending_room_setup','room_setup_failed')) then 'pending_retry'
    when exists(select 1 from public.employee_advance_message_deliveries d where d.advance_case_id=target_case_id and d.status='queued') then 'queued'
    when exists(select 1 from public.employee_advance_message_deliveries d where d.advance_case_id=target_case_id and d.status='sent') then 'sent'
    when exists(select 1 from public.employee_advance_message_deliveries d where d.advance_case_id=target_case_id and d.status='delivered') then 'delivered'
    else 'not_required'
  end into next_status;
  update public.employee_advance_cases
  set confirmation_delivery_status=next_status,
      confirmation_delivery_error=(select left(string_agg(d.last_error,E'\n' order by d.updated_at desc),2000)
        from public.employee_advance_message_deliveries d
        where d.advance_case_id=target_case_id and d.status in ('failed','pending_room_setup','room_setup_failed')),
      confirmation_delivery_updated_at=now(),
      updated_at=now()
  where id=target_case_id;
end $$;

create or replace function public.ensure_advance_confirmation_room(
  target_company_id uuid,
  target_room_key text,
  target_source_room_id uuid default null,
  target_source_room_name text default null,
  target_source_profile_id uuid default null,
  target_advance_case_id uuid default null,
  target_event_key text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  room_id uuid; creator_id uuid; room_name text; integration_key_value text; reason_value text;
begin
  if target_room_key not in ('hr_primary','finance_primary','source_room') then
    raise exception 'advance_confirmation_room_key_invalid';
  end if;
  if target_company_id is null or target_advance_case_id is null or nullif(trim(target_event_key),'') is null then
    raise exception 'advance_confirmation_room_context_required';
  end if;
  if target_room_key='source_room' and (
    target_source_room_id is null or nullif(trim(target_source_room_name),'') is null
    or lower(target_source_room_name) similar to '%(00|codex)%'
  ) then raise exception 'advance_confirmation_source_room_context_unverified'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_company_id::text||':'||target_room_key,0));
  room_name := case target_room_key when 'hr_primary' then 'HR' when 'finance_primary' then 'การเงิน' else btrim(target_source_room_name) end;
  integration_key_value := case target_room_key when 'hr_primary' then 'attendance' when 'finance_primary' then 'advance_confirmation' else null end;
  reason_value := case target_room_key when 'hr_primary' then 'Program Loop ต้องมีห้อง HR หลัก' when 'finance_primary' then 'Program Loop ต้องมีห้องเงินสำรองจ่าย/การเงินหลัก' else 'Program Loop ยืนยัน source context จาก Document Flow' end;

  if target_room_key='source_room' then
    select r.id into room_id from public.chat_rooms r where r.id=target_source_room_id and r.company_id=target_company_id;
  elsif integration_key_value is not null then
    select i.room_id into room_id from public.chat_room_integrations i where i.company_id=target_company_id and i.integration_key=integration_key_value and i.enabled limit 1;
  end if;
  if room_id is null then select r.id into room_id from public.chat_rooms r where r.company_id=target_company_id and r.room_key=target_room_key limit 1; end if;
  if room_id is null then select r.id into room_id from public.chat_rooms r where r.company_id=target_company_id and lower(r.name)=lower(room_name) limit 1; end if;

  creator_id := coalesce(auth.uid(),(
    select m.profile_id from public.company_members m where m.company_id=target_company_id and m.active
      and m.company_role in ('company_admin','executive','manager')
    order by case m.company_role when 'company_admin' then 1 when 'executive' then 2 else 3 end,m.created_at limit 1
  ));
  if creator_id is null then raise exception 'advance_confirmation_room_creator_not_found'; end if;
  if room_id is null then
    insert into public.chat_rooms(company_id,name,room_key,created_by)
    values(target_company_id,room_name,target_room_key,creator_id) returning id into room_id;
  else
    update public.chat_rooms set room_key=coalesce(room_key,target_room_key),updated_at=now()
    where id=room_id and company_id=target_company_id;
  end if;

  if target_room_key='finance_primary' then
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select room_id,m.profile_id,case when m.company_role='company_admin' then 'owner' else 'member' end
    from public.company_members m where m.company_id=target_company_id and m.active and m.company_role in ('company_admin','executive','manager')
    on conflict(room_id,profile_id) do nothing;
  elsif target_room_key='hr_primary' then
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select room_id,m.profile_id,case when m.company_role='company_admin' then 'owner' else 'member' end
    from public.company_members m where m.company_id=target_company_id and m.active and m.company_role in ('accounting_hr','company_admin','executive','manager','site_supervisor')
    on conflict(room_id,profile_id) do nothing;
  elsif target_source_room_id is not null then
    if not exists(select 1 from public.chat_room_members where room_id=target_source_room_id) then raise exception 'advance_confirmation_source_room_members_unverified'; end if;
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select room_id,m.profile_id,m.member_role from public.chat_room_members m where m.room_id=target_source_room_id
    on conflict(room_id,profile_id) do nothing;
    if target_source_profile_id is not null then
      insert into public.chat_room_members(room_id,profile_id,member_role) values(room_id,target_source_profile_id,'member') on conflict(room_id,profile_id) do nothing;
    end if;
  end if;
  if target_room_key='source_room' and not exists(select 1 from public.chat_room_members m where m.room_id=room_id) then
    raise exception 'advance_confirmation_source_room_members_unverified';
  end if;
  if integration_key_value is not null then
    insert into public.chat_room_integrations(company_id,integration_key,room_id,enabled,created_by)
    values(target_company_id,integration_key_value,room_id,true,creator_id)
    on conflict(company_id,integration_key) do update set room_id=excluded.room_id,enabled=true,updated_at=now();
  end if;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
  values(target_advance_case_id,target_company_id,'advance-room-setup:'||target_event_key||':'||target_room_key,'confirmation_room_setup',creator_id,
    jsonb_build_object('room_id',room_id,'room_key',target_room_key,'creator_id',creator_id,'created_at',now(),'advance_id',target_advance_case_id,'event_key',target_event_key),reason_value)
  on conflict(event_key) do nothing;
  return room_id;
end $$;

create or replace function public.deliver_employee_advance_confirmation(target_delivery_id uuid)
returns public.employee_advance_message_deliveries
language plpgsql security definer set search_path=public as $$
declare delivery public.employee_advance_message_deliveries; message_id uuid; error_text text;
begin
  select * into delivery from public.employee_advance_message_deliveries where id=target_delivery_id for update;
  if delivery.id is null then raise exception 'advance_confirmation_delivery_not_found'; end if;
  if delivery.status='delivered' then return delivery; end if;

  update public.employee_advance_message_deliveries
  set status='queued', retry_count=retry_count+1, attempts=retry_count+1,
      last_error=null, next_retry_at=null, updated_at=now()
  where id=delivery.id
  returning * into delivery;

  begin
    if delivery.room_id is null then raise exception 'advance_confirmation_room_not_configured'; end if;
    if not exists(select 1 from public.chat_rooms r where r.id=delivery.room_id and r.company_id=delivery.company_id) then
      raise exception 'advance_confirmation_room_company_mismatch';
    end if;
    if delivery.recipient_profile_id is null or not exists(
      select 1 from public.chat_room_members rm where rm.room_id=delivery.room_id and rm.profile_id=delivery.recipient_profile_id
    ) then raise exception 'advance_confirmation_recipient_not_in_room'; end if;

    insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
    values(delivery.company_id,delivery.room_id,null,'text',delivery.message_text,'system_confirmation')
    returning id into message_id;

    update public.employee_advance_message_deliveries
    set status='sent',chat_message_id=message_id,sent_at=now(),last_error=null,updated_at=now()
    where id=delivery.id;
    update public.employee_advance_message_deliveries
    set status='delivered',delivered_at=now(),next_retry_at=null,updated_at=now()
    where id=delivery.id
    returning * into delivery;
    update public.chat_rooms set updated_at=now() where id=delivery.room_id and company_id=delivery.company_id;
    insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
    values(delivery.advance_case_id,delivery.company_id,
      'advance-confirm-delivered:'||delivery.id::text||':'||delivery.retry_count,
      'confirmation_delivered',delivery.created_by,
      jsonb_build_object('delivery_id',delivery.id,'chat_message_id',delivery.chat_message_id,'retry_count',delivery.retry_count),
      'System Confirmation ส่งเข้า Web Chat สำเร็จ') on conflict(event_key) do nothing;
  exception when others then
    get stacked diagnostics error_text = message_text;
    update public.employee_advance_message_deliveries
    set status='failed',last_error=left(error_text,1000),next_retry_at=now()+interval '5 minutes',updated_at=now()
    where id=delivery.id
    returning * into delivery;
    insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
    values(delivery.advance_case_id,delivery.company_id,
      'advance-confirm-failed:'||delivery.id::text||':'||delivery.retry_count,
      'confirmation_delivery_failed',delivery.created_by,
      jsonb_build_object('delivery_id',delivery.id,'retry_count',delivery.retry_count,'error',delivery.last_error),
      'System Confirmation ส่งไม่สำเร็จ; ค้างรอ Retry') on conflict(event_key) do nothing;
  end;
  perform public.refresh_employee_advance_confirmation_status(delivery.advance_case_id);
  select * into delivery from public.employee_advance_message_deliveries where id=delivery.id;
  return delivery;
end $$;

create or replace function public.queue_employee_advance_confirmation(target_advance_case_id uuid)
returns public.employee_advance_message_deliveries
language plpgsql security definer set search_path=public as $$
declare
  case_row public.employee_advance_cases; parent_row public.employee_advance_cases;
  holder_name text; project_name text; document_row uuid; actor_name text;
  source_room_id uuid; finance_room_id uuid; hr_room_id uuid; source_profile_id uuid; finance_profile_id uuid; hr_profile_id uuid;
  source_room_name text; is_hr_condition boolean; finance_scope text[]; delivery public.employee_advance_message_deliveries;
  target record; target_key text; delivery_key_value text; message_value text;
  finance_setup_error text; hr_setup_error text; source_setup_error text; source_context_confirmed boolean;
begin
  select * into case_row from public.employee_advance_cases where id=target_advance_case_id for update;
  if case_row.id is null then raise exception 'advance_case_not_found_or_denied'; end if;
  if auth.uid() is not null and not public.is_company_manager(case_row.company_id) then raise exception 'advance_confirmation_manager_required'; end if;
  if case_row.parent_case_id is not null then select * into parent_row from public.employee_advance_cases where id=case_row.parent_case_id; end if;
  document_row := coalesce(case_row.source_flow_item_id,parent_row.source_flow_item_id);
  select case when f.source_room_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and lower(coalesce(f.source_room_name,'')) not similar to '%(00|codex)%'
      then f.source_room_id::uuid end, f.source_room_name
    into source_room_id,source_room_name
    from public.document_flow_items f where f.id=document_row;
  select coalesce(nullif(trim(p.full_name),''),nullif(trim(ep.full_name),''),'ไม่ระบุชื่อ') into holder_name
  from public.employee_advance_cases c left join public.profiles p on p.id=c.holder_profile_id left join public.employee_people ep on ep.id=c.holder_person_id where c.id=case_row.id;
  select coalesce(pr.name,'ไม่ระบุโครงการ') into project_name from public.projects pr where pr.id=coalesce(case_row.project_id,parent_row.project_id);
  actor_name := coalesce((select nullif(trim(p.full_name),'') from public.profiles p where p.id=case_row.created_by),case_row.created_by::text,'ระบบ');
  is_hr_condition := case_row.parent_case_id is not null
    or case_row.holder_person_id is not null
    or exists(select 1 from public.employee_advance_settlement_items i
      where i.case_id=coalesce(parent_row.id,case_row.id)
        and i.expense_type in ('daily_wage','payroll_offset'));
  source_context_confirmed := source_room_id is not null and nullif(trim(source_room_name),'') is not null
    and lower(source_room_name) not similar to '%(00|codex)%';
  begin
    finance_room_id := public.ensure_advance_confirmation_room(case_row.company_id,'finance_primary',null,null,null,case_row.id,'advance-confirm:'||case_row.id::text);
  exception when others then finance_setup_error := left(sqlerrm,1000); end;
  if is_hr_condition then
    begin
      hr_room_id := public.ensure_advance_confirmation_room(case_row.company_id,'hr_primary',null,null,null,case_row.id,'advance-confirm:'||case_row.id::text);
    exception when others then hr_setup_error := left(sqlerrm,1000); end;
  end if;
  if source_context_confirmed then
    begin
      source_room_id := public.ensure_advance_confirmation_room(case_row.company_id,'source_room',source_room_id,source_room_name,null,case_row.id,'advance-confirm:'||case_row.id::text);
    exception when others then source_setup_error := left(sqlerrm,1000); end;
  end if;
  update public.employee_advance_cases
  set confirmation_room_setup_status=case when finance_setup_error is not null or hr_setup_error is not null or source_setup_error is not null then 'failed' else 'ready' end,
      confirmation_room_setup_error=coalesce(finance_setup_error,hr_setup_error,source_setup_error),updated_at=now()
  where id=case_row.id;
  select m.profile_id into finance_profile_id from public.company_members m
  join public.chat_room_members rm on rm.room_id=finance_room_id and rm.profile_id=m.profile_id
  where m.company_id=case_row.company_id and m.active and m.company_role in ('company_admin','executive','manager')
  order by case m.company_role when 'company_admin' then 1 when 'executive' then 2 else 3 end,m.created_at limit 1;
  select m.profile_id into hr_profile_id from public.company_members m
  join public.chat_room_members rm on rm.room_id=hr_room_id and rm.profile_id=m.profile_id
  where m.company_id=case_row.company_id and m.active
  order by case m.company_role when 'accounting_hr' then 1 when 'manager' then 2 when 'company_admin' then 3 when 'site_supervisor' then 4 else 5 end,m.created_at limit 1;
  select m.profile_id into source_profile_id
  from public.chat_room_members m where m.room_id=source_room_id
  order by case m.member_role when 'owner' then 1 else 2 end,m.joined_at limit 1;

  message_value := 'SYSTEM MSG CONFIRM — ห้ามนำข้อความนี้กลับไปสร้างรายการเบิกซ้ำ'
    || E'\nผู้รับ: ห้องต้นทาง/ห้องตัวเอง + การเงินหลัก'
    || case when is_hr_condition then ' + HR หลัก' else '' end
    || E'\nช่าง: '||coalesce(holder_name,'ไม่ระบุ')
    || E'\nวันที่เบิก: '||to_char(coalesce(case_row.received_at,case_row.created_at) at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI')
    || E'\nจำนวนเงิน: '||to_char(case_row.amount_received,'FM999,999,990.00')||' บาท'
    || E'\nโครงการ/ไซต์: '||coalesce(project_name,'ไม่ระบุ')
    || E'\nสถานะ: บันทึกสำเร็จ'
    || E'\nผู้บันทึก: '||actor_name
    || E'\nเวลา: '||to_char(case_row.created_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI')
    || E'\nAdvance ID: '||case_row.id::text
    || E'\nDocument ID: '||coalesce(document_row::text,'ไม่ระบุ');
  finance_scope := array['finance_primary'];
  if is_hr_condition and hr_room_id=finance_room_id then finance_scope := array_append(finance_scope,'hr_copied'); end if;

  for target in
    select 'source_room'::text recipient_kind,source_room_id room_id,source_profile_id recipient_profile_id,array['source_room']::text[] recipient_scope,source_setup_error setup_error
    where source_context_confirmed and source_room_id is distinct from finance_room_id and source_room_id is distinct from hr_room_id
    union all
    select 'finance_primary'::text recipient_kind,finance_room_id room_id,finance_profile_id recipient_profile_id,finance_scope recipient_scope,finance_setup_error setup_error
    union all
    select 'hr_primary'::text,hr_room_id,hr_profile_id,array['hr_primary']::text[],hr_setup_error
    where is_hr_condition and hr_room_id is distinct from finance_room_id and hr_room_id is distinct from source_room_id
  loop
    target_key := 'advance-confirm:'||case_row.id::text;
    delivery_key_value := target_key||':'||target.recipient_kind||':'||coalesce(target.room_id::text,'none');
    insert into public.employee_advance_message_deliveries(
      company_id,advance_case_id,document_id,message_kind,channel,room_id,recipient_profile_id,recipient_kind,recipient_scope,message_text,message_class,is_system,status,event_key,delivery_key,created_by
    ) values(case_row.company_id,case_row.id,document_row,'advance_confirm','web_chat',target.room_id,target.recipient_profile_id,target.recipient_kind,target.recipient_scope,message_value,'system_confirmation',true,
      case when target.setup_error is not null or target.room_id is null or target.recipient_profile_id is null then 'room_setup_failed' else 'queued' end,
      target_key,delivery_key_value,case_row.created_by)
    on conflict(delivery_key) do update set
      room_id=excluded.room_id,recipient_profile_id=excluded.recipient_profile_id,recipient_scope=excluded.recipient_scope,message_text=excluded.message_text,
      status=case when public.employee_advance_message_deliveries.status in ('delivered','sent') then public.employee_advance_message_deliveries.status else excluded.status end,
      last_error=case when public.employee_advance_message_deliveries.status in ('delivered','sent') then public.employee_advance_message_deliveries.last_error else target.setup_error end,
      next_retry_at=case when public.employee_advance_message_deliveries.status in ('delivered','sent') then public.employee_advance_message_deliveries.next_retry_at else now()+interval '5 minutes' end,
      updated_at=now();
    select * into delivery from public.employee_advance_message_deliveries where delivery_key=delivery_key_value;
    if target.setup_error is not null then
      update public.employee_advance_message_deliveries set last_error=target.setup_error, next_retry_at=now()+interval '5 minutes', updated_at=now() where id=delivery.id returning * into delivery;
    end if;
    insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
    values(case_row.id,case_row.company_id,'advance-confirm-queued:'||delivery_key_value,'confirmation_queued',case_row.created_by,
      jsonb_build_object('delivery_id',delivery.id,'recipient_kind',delivery.recipient_kind,'room_id',delivery.room_id,'recipient_scope',delivery.recipient_scope),
      'สร้าง System Confirmation หลังบันทึกรายการเงินสำรองจ่ายสำเร็จ') on conflict(event_key) do nothing;
    if delivery.status='queued' then perform public.deliver_employee_advance_confirmation(delivery.id); end if;
  end loop;
  perform public.refresh_employee_advance_confirmation_status(case_row.id);
  select * into delivery from public.employee_advance_message_deliveries where advance_case_id=case_row.id and recipient_kind='finance_primary' order by created_at limit 1;
  return delivery;
end $$;

create or replace function public.retry_employee_advance_confirmations(max_rows integer default 50)
returns integer language plpgsql security definer set search_path=public as $$
declare delivery record; changed integer:=0;
begin
  if auth.uid() is not null and not public.is_work_manager() then raise exception 'Permission denied'; end if;
  for delivery in
    select distinct d.advance_case_id id from public.employee_advance_message_deliveries d
    where d.status in ('failed','pending_room_setup','room_setup_failed') and d.retry_count<5 and (d.next_retry_at is null or d.next_retry_at<=now())
    order by d.advance_case_id limit greatest(1,least(coalesce(max_rows,50),200))
  loop
    perform public.queue_employee_advance_confirmation(delivery.id); changed:=changed+1;
  end loop;
  return changed;
end $$;

create or replace function public.employee_advance_confirmation_after_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  begin
    perform public.queue_employee_advance_confirmation(new.id);
  exception when others then
    update public.employee_advance_cases set confirmation_delivery_status='pending_retry',confirmation_delivery_error=left(sqlerrm,1000),confirmation_delivery_updated_at=now(),confirmation_room_setup_status='failed',confirmation_room_setup_error=left(sqlerrm,1000),updated_at=now() where id=new.id;
  end;
  return new;
end $$;
drop trigger if exists employee_advance_confirmation_after_insert_trigger on public.employee_advance_cases;
create trigger employee_advance_confirmation_after_insert_trigger
after insert on public.employee_advance_cases for each row execute function public.employee_advance_confirmation_after_insert();

revoke all on function public.refresh_employee_advance_confirmation_status(uuid),public.deliver_employee_advance_confirmation(uuid),public.queue_employee_advance_confirmation(uuid),public.retry_employee_advance_confirmations(integer),public.employee_advance_confirmation_after_insert() from public,anon;
grant execute on function public.queue_employee_advance_confirmation(uuid),public.retry_employee_advance_confirmations(integer) to authenticated;
notify pgrst,'reload schema';

;
