-- Local-first HR Confirmation Bundle. Do not apply to Production until the
-- local database fixture, RLS scenarios and authenticated UI UAT pass.

create table public.hr_confirmation_bundles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_profile_id uuid not null references public.profiles(id) on delete restrict,
  work_date date not null,
  project_id uuid references public.projects(id) on delete restrict,
  bundle_key text not null,
  status text not null default 'received' check (status in (
    'received','under_review','needs_more_info','pending_approval',
    'approved','recorded','closed','cancelled'
  )),
  validation_summary jsonb not null default '{}'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  confirmation_message_id uuid references public.chat_messages(id) on delete set null,
  confirmation_status text not null default 'not_ready' check (confirmation_status in (
    'not_ready','pending_send','sent','send_failed'
  )),
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  recorded_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  decision_note text,
  last_error text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,bundle_key)
);

create table public.hr_confirmation_bundle_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bundle_id uuid not null references public.hr_confirmation_bundles(id) on delete cascade,
  attendance_job_id uuid references public.chat_attendance_approval_jobs(id) on delete restrict,
  source_kind text not null check (source_kind in ('attendance_job','hr_summary')),
  source_ref text not null,
  source_channel text not null default 'web_chat' check (source_channel in ('web_chat','line','telegram','system')),
  request_code text,
  room_id uuid references public.chat_rooms(id) on delete set null,
  action text check (action is null or action in ('clock_in','clock_out')),
  requested_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,source_kind,source_ref),
  unique(attendance_job_id)
);

create table public.hr_confirmation_bundle_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bundle_id uuid not null references public.hr_confirmation_bundles(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  action_key text,
  source_kind text,
  source_ref text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,bundle_id,action_key)
);

create table public.hr_intake_raw_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  raw_message_id uuid references public.chat_messages(id) on delete restrict,
  source_channel text not null default 'web_chat' check (source_channel in ('web_chat','line','telegram','system')),
  source_ref text not null,
  room_id uuid references public.chat_rooms(id) on delete set null,
  sender_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in (
    'pending','context','duplicate','already_confirmed','not_hr','low_confidence',
    'candidate','needs_more_info','rejected','confirmed'
  )),
  content_snapshot text,
  extracted_payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  classification_reason text,
  duplicate_of_id uuid references public.hr_intake_raw_items(id) on delete restrict,
  attendance_job_id uuid references public.chat_attendance_approval_jobs(id) on delete set null,
  bundle_id uuid references public.hr_confirmation_bundles(id) on delete set null,
  classified_by uuid references public.profiles(id) on delete set null,
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,source_channel,source_ref)
);

create table public.hr_intake_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  raw_item_id uuid not null references public.hr_intake_raw_items(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  action_key text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,raw_item_id,action_key)
);

create index hr_confirmation_bundle_queue_idx
  on public.hr_confirmation_bundles(company_id,status,work_date desc,updated_at desc);
create index hr_confirmation_bundle_employee_idx
  on public.hr_confirmation_bundles(company_id,employee_profile_id,work_date desc);
create index hr_confirmation_bundle_item_order_idx
  on public.hr_confirmation_bundle_items(company_id,bundle_id,requested_at,action);
create index hr_confirmation_bundle_event_idx
  on public.hr_confirmation_bundle_events(company_id,bundle_id,created_at);
create index hr_intake_gate_queue_idx on public.hr_intake_raw_items(company_id,status,created_at desc);
create index hr_intake_gate_duplicate_idx on public.hr_intake_raw_items(company_id,duplicate_of_id) where duplicate_of_id is not null;
create index hr_intake_event_idx on public.hr_intake_events(company_id,raw_item_id,created_at);

alter table public.hr_confirmation_bundles enable row level security;
alter table public.hr_confirmation_bundle_items enable row level security;
alter table public.hr_confirmation_bundle_events enable row level security;
alter table public.hr_intake_raw_items enable row level security;
alter table public.hr_intake_events enable row level security;

create policy "HR confirmation owner or manager reads bundles"
on public.hr_confirmation_bundles for select to authenticated
using (
  company_id=public.current_company_id()
  and (employee_profile_id=auth.uid() or public.is_company_manager(company_id))
);
create policy "HR confirmation owner or manager reads items"
on public.hr_confirmation_bundle_items for select to authenticated
using (
  hr_confirmation_bundle_items.company_id=public.current_company_id()
  and exists (
    select 1 from public.hr_confirmation_bundles bundle
    where bundle.id=hr_confirmation_bundle_items.bundle_id
      and bundle.company_id=hr_confirmation_bundle_items.company_id
      and (bundle.employee_profile_id=auth.uid() or public.is_company_manager(company_id))
  )
);
create policy "HR confirmation owner or manager reads events"
on public.hr_confirmation_bundle_events for select to authenticated
using (
  hr_confirmation_bundle_events.company_id=public.current_company_id()
  and exists (
    select 1 from public.hr_confirmation_bundles bundle
    where bundle.id=hr_confirmation_bundle_events.bundle_id
      and bundle.company_id=hr_confirmation_bundle_events.company_id
      and (bundle.employee_profile_id=auth.uid() or public.is_company_manager(company_id))
  )
);
create policy "HR managers read intake raw"
on public.hr_intake_raw_items for select to authenticated
using (company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "HR managers read intake audit"
on public.hr_intake_events for select to authenticated
using (company_id=public.current_company_id() and public.is_company_manager(company_id));

revoke insert,update,delete on public.hr_confirmation_bundles from anon,authenticated;
revoke insert,update,delete on public.hr_confirmation_bundle_items from anon,authenticated;
revoke insert,update,delete on public.hr_confirmation_bundle_events from anon,authenticated;
grant select on public.hr_confirmation_bundles,public.hr_confirmation_bundle_items,public.hr_confirmation_bundle_events to authenticated;
revoke insert,update,delete on public.hr_intake_raw_items,public.hr_intake_events from anon,authenticated;
grant select on public.hr_intake_raw_items,public.hr_intake_events to authenticated;

create or replace function public.capture_hr_intake_raw_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare raw_item public.hr_intake_raw_items; initial_status text; initial_reason text;
begin
  initial_status:=case
    when new.message_class='system_confirmation' then 'context'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'context'
    else 'pending'
  end;
  initial_reason:=case
    when new.message_class='system_confirmation' then 'system_confirmation_context_only'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'daily_summary_context_only'
    else 'awaiting_hr_intake_classification'
  end;
  insert into public.hr_intake_raw_items(
    company_id,raw_message_id,source_channel,source_ref,room_id,sender_profile_id,status,content_snapshot,classification_reason,
    classified_at
  ) values(
    new.company_id,new.id,'web_chat',new.id::text,new.room_id,new.sender_profile_id,initial_status,new.text_content,initial_reason,
    case when initial_status='context' then now() else null end
  ) on conflict(company_id,source_channel,source_ref) do nothing returning * into raw_item;
  if raw_item.id is not null then
    insert into public.hr_intake_events(company_id,raw_item_id,event_type,from_status,to_status,reason,details)
    values(new.company_id,raw_item.id,'raw_received',null,initial_status,initial_reason,jsonb_build_object('message_class',new.message_class,'room_id',new.room_id));
  end if;
  return new;
end $$;

create or replace function public.classify_hr_intake_item(
  target_raw_item_id uuid,target_classification text,target_reason text,target_confidence numeric,
  target_payload jsonb default '{}'::jsonb,target_duplicate_of_id uuid default null,
  target_attendance_job_id uuid default null,target_bundle_id uuid default null,target_action_key text default null
) returns public.hr_intake_raw_items
language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); raw_item public.hr_intake_raw_items; previous_status text; action_key_value text:=nullif(trim(coalesce(target_action_key,'')),'');
begin
  select * into raw_item from public.hr_intake_raw_items where id=target_raw_item_id for update;
  if not found then raise exception 'hr_intake_item_not_found'; end if;
  if actor_id is null or not public.is_company_manager(raw_item.company_id) then raise exception 'hr_intake_manager_required'; end if;
  if target_classification not in ('context','duplicate','already_confirmed','not_hr','low_confidence','candidate') then raise exception 'hr_intake_classification_invalid'; end if;
  if action_key_value is null or nullif(trim(coalesce(target_reason,'')),'') is null then raise exception 'hr_intake_reason_and_action_key_required'; end if;
  if exists(select 1 from public.hr_intake_events event where event.raw_item_id=raw_item.id and event.action_key=action_key_value) then return raw_item; end if;
  if target_classification='duplicate' and target_duplicate_of_id is null then raise exception 'hr_intake_duplicate_link_required'; end if;
  if target_classification='already_confirmed' and target_bundle_id is null then raise exception 'hr_intake_confirmed_bundle_link_required'; end if;
  if target_classification='low_confidence' and (target_confidence is null or target_confidence>=0.75) then raise exception 'hr_intake_low_confidence_invalid'; end if;
  if target_classification='candidate' and (
    nullif(trim(coalesce(target_payload->>'employee_profile_id','')),'') is null
    or nullif(trim(coalesce(target_payload->>'work_date','')),'') is null
    or nullif(trim(coalesce(target_payload->>'project_id','')),'') is null
    or coalesce(target_payload->>'action','') not in ('clock_in','clock_out')
    or nullif(trim(coalesce(target_payload->>'request_code','')),'') is null
    or target_attendance_job_id is null
  ) then raise exception 'hr_intake_candidate_incomplete'; end if;
  previous_status:=raw_item.status;
  update public.hr_intake_raw_items set
    status=target_classification,classification_reason=trim(target_reason),confidence=target_confidence,
    extracted_payload=coalesce(target_payload,'{}'::jsonb),duplicate_of_id=target_duplicate_of_id,
    attendance_job_id=target_attendance_job_id,bundle_id=target_bundle_id,classified_by=actor_id,classified_at=now(),updated_at=now()
  where id=raw_item.id returning * into raw_item;
  insert into public.hr_intake_events(company_id,raw_item_id,actor_profile_id,event_type,from_status,to_status,action_key,reason,details)
  values(raw_item.company_id,raw_item.id,actor_id,'intake_classified',previous_status,raw_item.status,action_key_value,trim(target_reason),
    jsonb_build_object('confidence',target_confidence,'duplicate_of_id',target_duplicate_of_id,'attendance_job_id',target_attendance_job_id,'bundle_id',target_bundle_id));
  return raw_item;
end $$;

create or replace function public.act_hr_intake_item(
  target_raw_item_id uuid,target_action text,target_reason text,target_action_key text
) returns public.hr_intake_raw_items
language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); raw_item public.hr_intake_raw_items; bundle public.hr_confirmation_bundles; previous_status text;
begin
  select * into raw_item from public.hr_intake_raw_items where id=target_raw_item_id for update;
  if not found then raise exception 'hr_intake_item_not_found'; end if;
  if actor_id is null or not public.is_company_manager(raw_item.company_id) then raise exception 'hr_intake_manager_required'; end if;
  if target_action not in ('confirm','request_more','reject') then raise exception 'hr_intake_action_invalid'; end if;
  if nullif(trim(coalesce(target_action_key,'')),'') is null then raise exception 'hr_intake_action_key_required'; end if;
  if exists(select 1 from public.hr_intake_events event where event.raw_item_id=raw_item.id and event.action_key=trim(target_action_key)) then return raw_item; end if;
  if target_action in ('request_more','reject') and nullif(trim(coalesce(target_reason,'')),'') is null then raise exception 'hr_intake_reason_required'; end if;
  previous_status:=raw_item.status;
  if target_action='confirm' then
    if raw_item.status<>'candidate' or raw_item.attendance_job_id is null then raise exception 'hr_intake_candidate_required'; end if;
    bundle:=public.sync_hr_confirmation_bundle_for_job(raw_item.attendance_job_id);
    update public.hr_intake_raw_items set status='confirmed',bundle_id=bundle.id,classification_reason='candidate_confirmed_to_bundle',updated_at=now()
    where id=raw_item.id returning * into raw_item;
    insert into public.hr_intake_events(company_id,raw_item_id,actor_profile_id,event_type,from_status,to_status,action_key,reason,details)
    values(raw_item.company_id,raw_item.id,actor_id,'candidate_confirmed',previous_status,raw_item.status,trim(target_action_key),target_reason,jsonb_build_object('bundle_id',bundle.id));
    return raw_item;
  end if;
  update public.hr_intake_raw_items set status=case when target_action='request_more' then 'needs_more_info' else 'rejected' end,
    classification_reason=trim(target_reason),classified_by=actor_id,classified_at=now(),updated_at=now()
  where id=raw_item.id returning * into raw_item;
  insert into public.hr_intake_events(company_id,raw_item_id,actor_profile_id,event_type,from_status,to_status,action_key,reason)
  values(raw_item.company_id,raw_item.id,actor_id,case when target_action='request_more' then 'more_information_required' else 'intake_rejected' end,
    previous_status,raw_item.status,trim(target_action_key),trim(target_reason));
  return raw_item;
end $$;

create or replace function public.hr_intake_gate_counts()
returns jsonb language sql security definer set search_path=public as $$
  select case when auth.uid() is null or public.current_company_id() is null then '{}'::jsonb else jsonb_build_object(
    'raw_total',count(*),
    'pending',count(*) filter(where status='pending'),
    'candidate',count(*) filter(where status='candidate'),
    'context',count(*) filter(where status='context'),
    'duplicate',count(*) filter(where status='duplicate'),
    'already_confirmed',count(*) filter(where status='already_confirmed'),
    'not_hr',count(*) filter(where status='not_hr'),
    'low_confidence',count(*) filter(where status='low_confidence'),
    'needs_more_info',count(*) filter(where status='needs_more_info'),
    'confirmed',count(*) filter(where status='confirmed'),
    'rejected',count(*) filter(where status='rejected')
  ) end from public.hr_intake_raw_items where company_id=public.current_company_id() and public.is_company_manager(company_id)
$$;

create or replace function public.refresh_hr_confirmation_bundle(target_bundle_id uuid)
returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare
  bundle public.hr_confirmation_bundles;
  input_count integer;
  output_count integer;
  item_count integer;
  first_input timestamptz;
  first_output timestamptz;
  missing_fields text[] := '{}';
  conflicts text[] := '{}';
  employee_name text;
  next_status text;
  previous_status text;
begin
  select * into bundle from public.hr_confirmation_bundles where id=target_bundle_id for update;
  if not found then raise exception 'hr_confirmation_bundle_not_found'; end if;

  select nullif(trim(coalesce(profile.full_name,'')),'') into employee_name
  from public.profiles profile where profile.id=bundle.employee_profile_id;
  if employee_name is null then missing_fields:=array_append(missing_fields,'employee_name'); end if;
  if not exists (
    select 1 from public.company_members member
    where member.company_id=bundle.company_id and member.profile_id=bundle.employee_profile_id and member.active
  ) then conflicts:=array_append(conflicts,'employee_company_mismatch'); end if;

  select count(*),count(*) filter(where item.action='clock_in'),count(*) filter(where item.action='clock_out'),
    min(item.requested_at) filter(where item.action='clock_in'),min(item.requested_at) filter(where item.action='clock_out')
  into item_count,input_count,output_count,first_input,first_output
  from public.hr_confirmation_bundle_items item where item.bundle_id=bundle.id;

  if input_count=0 then missing_fields:=array_append(missing_fields,'clock_in'); end if;
  if output_count=0 then missing_fields:=array_append(missing_fields,'clock_out'); end if;
  if input_count>1 then conflicts:=array_append(conflicts,'duplicate_clock_in'); end if;
  if output_count>1 then conflicts:=array_append(conflicts,'duplicate_clock_out'); end if;
  if first_input is not null and first_output is not null and first_input>=first_output then conflicts:=array_append(conflicts,'invalid_time_order'); end if;
  if exists (
    select 1 from public.hr_confirmation_bundle_items item
    join public.chat_attendance_approval_jobs job on job.id=item.attendance_job_id
    where item.bundle_id=bundle.id and (
      job.company_id<>bundle.company_id or job.requester_profile_id<>bundle.employee_profile_id
      or job.duplicate_of_job_id is not null
      or coalesce(jsonb_array_length(job.validation_result->'missing_fields'),0)>0
    )
  ) then conflicts:=array_append(conflicts,'source_job_conflict'); end if;
  if exists (
    select 1 from public.hr_confirmation_bundle_items item
    join public.chat_attendance_approval_jobs job on job.id=item.attendance_job_id
    left join public.project_sites site on site.id=job.site_id
    where item.bundle_id=bundle.id and coalesce(site.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
      <>coalesce(bundle.project_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) then conflicts:=array_append(conflicts,'project_mismatch'); end if;

  previous_status:=bundle.status;
  if bundle.status not in ('approved','recorded','closed','cancelled','under_review') then
    update public.hr_confirmation_bundles set status='under_review',updated_at=now(),version=version+1
    where id=bundle.id returning * into bundle;
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
    values(bundle.company_id,bundle.id,'review_started',previous_status,'under_review',jsonb_build_object('automated',true));
    previous_status:='under_review';
  end if;
  next_status:=case
    when bundle.status in ('approved','recorded','closed','cancelled') then bundle.status
    when cardinality(missing_fields)>0 or cardinality(conflicts)>0 then 'needs_more_info'
    else 'pending_approval'
  end;
  update public.hr_confirmation_bundles set
    status=next_status,
    validation_summary=jsonb_build_object(
      'employee_name',employee_name,'item_count',item_count,'clock_in_count',input_count,
      'clock_out_count',output_count,'clock_in_at',first_input,'clock_out_at',first_output,
      'missing_fields',missing_fields,'conflicts',conflicts,'checked_at',now()
    ),
    confirmation_status=case when next_status='pending_approval' and confirmation_message_id is null then 'pending_send' else confirmation_status end,
    last_error=null,version=version+1,updated_at=now()
  where id=bundle.id returning * into bundle;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
  values(bundle.company_id,bundle.id,'validation_completed',previous_status,bundle.status,bundle.validation_summary);
  if bundle.status='pending_approval' and previous_status is distinct from 'pending_approval' then
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,action_key,details)
    values(bundle.company_id,bundle.id,'approval_requested',previous_status,'pending_approval','approval-requested:'||bundle.version,
      jsonb_build_object('confirmation_status',bundle.confirmation_status));
  end if;
  return bundle;
end $$;

create or replace function public.sync_hr_confirmation_bundle_for_job(target_job_id uuid)
returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare
  job public.chat_attendance_approval_jobs;
  target_project_id uuid;
  target_date date;
  key_value text;
  bundle public.hr_confirmation_bundles;
begin
  select * into job from public.chat_attendance_approval_jobs where id=target_job_id;
  if not found then raise exception 'attendance_job_not_found'; end if;
  select site.project_id into target_project_id from public.project_sites site
  where site.id=job.site_id and site.company_id=job.company_id;
  target_date:=(job.requested_at at time zone 'Asia/Bangkok')::date;
  key_value:=concat(job.requester_profile_id,':',target_date,':',coalesce(target_project_id::text,'no-project'));
  perform pg_advisory_xact_lock(hashtextextended(job.company_id::text||':'||key_value,0));
  insert into public.hr_confirmation_bundles(company_id,employee_profile_id,work_date,project_id,bundle_key,status,source_summary)
  values(job.company_id,job.requester_profile_id,target_date,target_project_id,key_value,'received',jsonb_build_object('channels',jsonb_build_array('web_chat')))
  on conflict(company_id,bundle_key) do update set updated_at=now(),version=public.hr_confirmation_bundles.version+1
  returning * into bundle;
  insert into public.hr_confirmation_bundle_items(
    company_id,bundle_id,attendance_job_id,source_kind,source_ref,source_channel,request_code,room_id,action,requested_at,source_payload
  ) values(
    job.company_id,bundle.id,job.id,'attendance_job',job.id::text,'web_chat',job.request_code,job.room_id,job.action,job.requested_at,
    jsonb_build_object('validation_result',job.validation_result,'selfie_path',job.selfie_path,'site_id',job.site_id)
  ) on conflict(company_id,source_kind,source_ref) do nothing;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,action_key,source_kind,source_ref,details)
  values(job.company_id,bundle.id,'bundle_received',null,'received','receive:'||job.id,'attendance_job',job.id::text,jsonb_build_object('request_code',job.request_code))
  on conflict(company_id,bundle_id,action_key) do nothing;
  return public.refresh_hr_confirmation_bundle(bundle.id);
end $$;

create or replace function public.attach_hr_confirmation_summary(
  target_bundle_id uuid,target_source_ref text,target_payload jsonb,target_action_key text
) returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); bundle public.hr_confirmation_bundles;
begin
  select * into bundle from public.hr_confirmation_bundles where id=target_bundle_id for update;
  if actor_id is null or not public.is_company_manager(bundle.company_id) then raise exception 'hr_confirmation_manager_required'; end if;
  if nullif(trim(coalesce(target_source_ref,'')),'') is null or nullif(trim(coalesce(target_action_key,'')),'') is null then raise exception 'hr_confirmation_source_reference_required'; end if;
  insert into public.hr_confirmation_bundle_items(company_id,bundle_id,source_kind,source_ref,source_channel,source_payload)
  values(bundle.company_id,bundle.id,'hr_summary',trim(target_source_ref),'web_chat',coalesce(target_payload,'{}'::jsonb))
  on conflict(company_id,source_kind,source_ref) do nothing;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,source_kind,source_ref,details)
  values(bundle.company_id,bundle.id,actor_id,'hr_summary_attached',bundle.status,bundle.status,trim(target_action_key),'hr_summary',trim(target_source_ref),coalesce(target_payload,'{}'::jsonb))
  on conflict(company_id,bundle_id,action_key) do nothing;
  return public.refresh_hr_confirmation_bundle(bundle.id);
end $$;

create or replace function public.act_hr_confirmation_bundle(
  target_bundle_id uuid,target_action text,target_reason text default null,target_action_key text default null
) returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare
  actor_id uuid:=auth.uid();
  bundle public.hr_confirmation_bundles;
  refreshed public.hr_confirmation_bundles;
  item record;
  child public.chat_attendance_approval_jobs;
  previous_status text;
  recorded_count integer;
  item_count integer;
  audit_count integer;
  action_key_value text:=nullif(trim(coalesce(target_action_key,'')),'');
begin
  select * into bundle from public.hr_confirmation_bundles where id=target_bundle_id for update;
  if not found then raise exception 'hr_confirmation_bundle_not_found'; end if;
  if actor_id is null or not public.is_company_manager(bundle.company_id) then raise exception 'hr_confirmation_manager_required'; end if;
  if target_action not in ('confirm','request_more','reject','close') then raise exception 'hr_confirmation_action_invalid'; end if;
  if action_key_value is null then raise exception 'hr_confirmation_action_key_required'; end if;
  if exists(select 1 from public.hr_confirmation_bundle_events event where event.bundle_id=bundle.id and event.action_key=action_key_value) then return bundle; end if;
  if target_action in ('request_more','reject') and nullif(trim(coalesce(target_reason,'')),'') is null then raise exception 'hr_confirmation_reason_required'; end if;
  previous_status:=bundle.status;

  if target_action='request_more' then
    for item in select attendance_job_id from public.hr_confirmation_bundle_items where bundle_id=bundle.id and attendance_job_id is not null loop
      select * into child from public.chat_attendance_approval_jobs where id=item.attendance_job_id;
      if child.status='pending_approval' then perform public.review_web_chat_attendance_job(child.id,'request_more',target_reason); end if;
    end loop;
    update public.hr_confirmation_bundles set status='needs_more_info',responsible_profile_id=employee_profile_id,decision_note=trim(target_reason),updated_at=now(),version=version+1
    where id=bundle.id returning * into bundle;
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
    values(bundle.company_id,bundle.id,actor_id,'more_information_required',previous_status,bundle.status,action_key_value,jsonb_build_object('reason',target_reason));
    return bundle;
  end if;

  if target_action='reject' then
    for item in select attendance_job_id from public.hr_confirmation_bundle_items where bundle_id=bundle.id and attendance_job_id is not null loop
      select * into child from public.chat_attendance_approval_jobs where id=item.attendance_job_id;
      if child.status='pending_approval' then perform public.review_web_chat_attendance_job(child.id,'reject',target_reason); end if;
    end loop;
    update public.hr_confirmation_bundles set status='cancelled',cancelled_by=actor_id,cancelled_at=now(),decision_note=trim(target_reason),updated_at=now(),version=version+1
    where id=bundle.id returning * into bundle;
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
    values(bundle.company_id,bundle.id,actor_id,'bundle_rejected',previous_status,bundle.status,action_key_value,jsonb_build_object('reason',target_reason));
    return bundle;
  end if;

  if target_action='confirm' then
    refreshed:=public.refresh_hr_confirmation_bundle(bundle.id);
    if refreshed.status<>'pending_approval' then raise exception 'hr_confirmation_validation_failed'; end if;
    begin
      update public.hr_confirmation_bundles set status='approved',approved_by=actor_id,approved_at=now(),decision_note=nullif(trim(coalesce(target_reason,'')),''),updated_at=now(),version=version+1
      where id=bundle.id returning * into bundle;
      insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
      values(bundle.company_id,bundle.id,actor_id,'approval_granted',previous_status,'approved',action_key_value,jsonb_build_object('reason',target_reason));
      for item in
        select attendance_job_id from public.hr_confirmation_bundle_items
        where bundle_id=bundle.id and attendance_job_id is not null
        order by case action when 'clock_in' then 1 else 2 end,requested_at
      loop
        select * into child from public.chat_attendance_approval_jobs where id=item.attendance_job_id;
        if child.status='pending_approval' then child:=public.review_web_chat_attendance_job(child.id,'approve',target_reason); end if;
        if child.status<>'recorded' then raise exception 'hr_confirmation_child_not_recorded:%',child.id; end if;
        insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,source_kind,source_ref,details)
        values(bundle.company_id,bundle.id,actor_id,'child_attendance_recorded','approved','approved','attendance_job',child.id::text,jsonb_build_object('attendance_session_id',child.attendance_session_id));
      end loop;
      select count(*),count(*) filter(where job.status='recorded' and job.attendance_session_id is not null)
      into item_count,recorded_count from public.hr_confirmation_bundle_items bundle_item
      join public.chat_attendance_approval_jobs job on job.id=bundle_item.attendance_job_id where bundle_item.bundle_id=bundle.id;
      if item_count=0 or recorded_count<>item_count then raise exception 'hr_confirmation_attendance_write_incomplete'; end if;
      update public.hr_confirmation_bundles set status='recorded',recorded_at=now(),last_error=null,updated_at=now(),version=version+1
      where id=bundle.id returning * into bundle;
      insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,details)
      values(bundle.company_id,bundle.id,actor_id,'bundle_recorded','approved','recorded',jsonb_build_object('recorded_count',recorded_count));
      return bundle;
    exception when others then
      update public.hr_confirmation_bundles set status='needs_more_info',last_error=left(sqlerrm,1000),responsible_profile_id=employee_profile_id,updated_at=now(),version=version+1
      where id=bundle.id returning * into bundle;
      insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
      values(bundle.company_id,bundle.id,actor_id,'action_failed',previous_status,bundle.status,action_key_value,jsonb_build_object('error',bundle.last_error));
      return bundle;
    end;
  end if;

  if bundle.status='closed' then return bundle; end if;
  if bundle.status<>'recorded' then raise exception 'hr_confirmation_close_requires_recorded'; end if;
  select count(*) into item_count from public.hr_confirmation_bundle_items where bundle_id=bundle.id and attendance_job_id is not null;
  select count(*) into recorded_count from public.hr_confirmation_bundle_items bundle_item join public.chat_attendance_approval_jobs job on job.id=bundle_item.attendance_job_id
  where bundle_item.bundle_id=bundle.id and job.status='recorded' and job.attendance_session_id is not null;
  select count(distinct event_type) into audit_count from public.hr_confirmation_bundle_events
  where bundle_id=bundle.id and event_type in ('bundle_received','validation_completed','approval_granted','child_attendance_recorded','bundle_recorded');
  if item_count=0 or recorded_count<>item_count or audit_count<>5
    or coalesce(jsonb_array_length(bundle.validation_summary->'missing_fields'),0)>0
    or coalesce(jsonb_array_length(bundle.validation_summary->'conflicts'),0)>0 then raise exception 'hr_confirmation_close_gate_failed'; end if;
  update public.hr_confirmation_bundles set status='closed',closed_by=actor_id,closed_at=now(),updated_at=now(),version=version+1
  where id=bundle.id returning * into bundle;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
  values(bundle.company_id,bundle.id,actor_id,'bundle_closed_100_percent','recorded','closed',action_key_value,jsonb_build_object('item_count',item_count,'audit_count',audit_count));
  return bundle;
end $$;

create or replace function public.publish_hr_confirmation_bundle()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_value uuid; recipient uuid; msg_id uuid; employee_name text; project_name text; msg text;
begin
  if new.status<>'pending_approval' or new.confirmation_message_id is not null then return new; end if;
  if new.confirmation_status='pending_send' and new.last_error='hr_confirmation_destination_missing' then return new; end if;
  select item.room_id into room_value from public.hr_confirmation_bundle_items item where item.bundle_id=new.id and item.room_id is not null order by item.created_at limit 1;
  select member.profile_id into recipient from public.company_members member
  where member.company_id=new.company_id and member.active and member.company_role in ('company_admin','executive','manager','accounting_hr')
  order by case member.company_role when 'company_admin' then 1 when 'executive' then 2 when 'manager' then 3 else 4 end limit 1;
  if room_value is null or recipient is null then
    update public.hr_confirmation_bundles set confirmation_status='pending_send',last_error='hr_confirmation_destination_missing',updated_at=now()
    where id=new.id and (confirmation_status,last_error) is distinct from ('pending_send','hr_confirmation_destination_missing');
    return new;
  end if;
  select coalesce(nullif(trim(profile.full_name),''),profile.email,profile.id::text) into employee_name from public.profiles profile where profile.id=new.employee_profile_id;
  select project.name into project_name from public.projects project where project.id=new.project_id;
  msg:='📦 HR Confirmation Bundle'||E'\nช่าง: '||coalesce(employee_name,'-')||E'\nวันที่: '||to_char(new.work_date,'DD/MM/YYYY')||E'\nโครงการ: '||coalesce(project_name,'-')||E'\nเข้า: '||coalesce(new.validation_summary->>'clock_in_at','-')||E'\nออก: '||coalesce(new.validation_summary->>'clock_out_at','-')||E'\nสถานะ: รออนุมัติ'||E'\nAction: ยืนยัน · ขอข้อมูลเพิ่ม · ปฏิเสธพร้อมเหตุผล';
  begin
    insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
    values(new.company_id,room_value,null,'text',msg,'system_confirmation') returning id into msg_id;
    update public.hr_confirmation_bundles set confirmation_message_id=msg_id,confirmation_status='sent',responsible_profile_id=recipient,last_error=null,updated_at=now() where id=new.id;
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
    values(new.company_id,new.id,'confirmation_sent',new.status,new.status,jsonb_build_object('message_id',msg_id,'recipient_profile_id',recipient,'room_id',room_value));
  exception when others then
    update public.hr_confirmation_bundles set confirmation_status='send_failed',last_error=left(sqlerrm,1000),updated_at=now() where id=new.id;
    insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
    values(new.company_id,new.id,'confirmation_failed',new.status,new.status,jsonb_build_object('error',left(sqlerrm,1000)));
  end;
  return new;
end $$;

create or replace function public.sync_hr_confirmation_bundle_trigger_function()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.sync_hr_confirmation_bundle_for_job(new.id);
  return new;
end $$;

drop trigger if exists publish_attendance_approval_message_trigger on public.chat_attendance_approval_jobs;
drop trigger if exists capture_hr_intake_raw_message_trigger on public.chat_messages;
create trigger capture_hr_intake_raw_message_trigger after insert on public.chat_messages
for each row execute function public.capture_hr_intake_raw_message();
drop trigger if exists sync_hr_confirmation_bundle_trigger on public.chat_attendance_approval_jobs;
create trigger sync_hr_confirmation_bundle_trigger after insert on public.chat_attendance_approval_jobs
for each row execute function public.sync_hr_confirmation_bundle_trigger_function();
drop trigger if exists publish_hr_confirmation_bundle_trigger on public.hr_confirmation_bundles;
create trigger publish_hr_confirmation_bundle_trigger after insert or update of status,confirmation_status on public.hr_confirmation_bundles
for each row execute function public.publish_hr_confirmation_bundle();

revoke all on function public.refresh_hr_confirmation_bundle(uuid) from public,anon,authenticated;
revoke all on function public.sync_hr_confirmation_bundle_for_job(uuid) from public,anon,authenticated;
revoke all on function public.capture_hr_intake_raw_message() from public,anon,authenticated;
revoke all on function public.sync_hr_confirmation_bundle_trigger_function() from public,anon,authenticated;
revoke all on function public.classify_hr_intake_item(uuid,text,text,numeric,jsonb,uuid,uuid,uuid,text) from public,anon;
revoke all on function public.act_hr_intake_item(uuid,text,text,text) from public,anon;
revoke all on function public.hr_intake_gate_counts() from public,anon;
revoke all on function public.attach_hr_confirmation_summary(uuid,text,jsonb,text) from public,anon;
revoke all on function public.act_hr_confirmation_bundle(uuid,text,text,text) from public,anon;
grant execute on function public.refresh_hr_confirmation_bundle(uuid) to service_role;
grant execute on function public.sync_hr_confirmation_bundle_for_job(uuid) to service_role;
grant execute on function public.classify_hr_intake_item(uuid,text,text,numeric,jsonb,uuid,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.act_hr_intake_item(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.hr_intake_gate_counts() to authenticated,service_role;
grant execute on function public.attach_hr_confirmation_summary(uuid,text,jsonb,text) to authenticated,service_role;
grant execute on function public.act_hr_confirmation_bundle(uuid,text,text,text) to authenticated,service_role;

-- Reconcile existing non-terminal jobs idempotently. Attendance rows are never edited here.
do $$ declare row_value record; begin
  for row_value in select id from public.chat_attendance_approval_jobs where status not in ('closed','rejected') order by created_at loop
    perform public.sync_hr_confirmation_bundle_for_job(row_value.id);
  end loop;
end $$;

notify pgrst,'reload schema';
