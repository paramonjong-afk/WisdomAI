-- ATT-CHANNEL-001: tenant-scoped intake ledger shared by Web, LINE and Telegram.
create table if not exists public.attendance_channel_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('web','line','telegram')),
  external_event_id text,
  external_user_id text,
  external_chat_id text,
  profile_id uuid references public.profiles(id) on delete restrict,
  site_id uuid references public.project_sites(id) on delete restrict,
  attendance_session_id uuid references public.attendance_sessions(id) on delete set null,
  action text not null check (action in ('clock_in','clock_out')),
  requested_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  selfie_path text,
  voice_path text,
  transcript text,
  note text,
  missing_fields text[] not null default '{}',
  status text not null default 'awaiting_confirmation' check (status in (
    'identity_required','information_required','awaiting_confirmation','pending_review',
    'approved','rejected','cancelled','expired','failed'
  )),
  source_payload jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attendance_channel_external_event_unique
  on public.attendance_channel_requests(channel,external_event_id)
  where external_event_id is not null;
create index if not exists attendance_channel_company_status_idx
  on public.attendance_channel_requests(company_id,status,requested_at desc);
create index if not exists attendance_channel_profile_idx
  on public.attendance_channel_requests(company_id,profile_id,requested_at desc);

create table if not exists public.attendance_channel_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid not null references public.attendance_channel_requests(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attendance_channel_events_request_idx
  on public.attendance_channel_events(request_id,created_at);

alter table public.attendance_channel_requests enable row level security;
alter table public.attendance_channel_events enable row level security;

create policy "Members read own or managed channel requests"
  on public.attendance_channel_requests for select to authenticated
  using (company_id=public.current_company_id() and (profile_id=auth.uid() or public.is_company_manager(company_id)));
create policy "Managers update channel requests"
  on public.attendance_channel_requests for update to authenticated
  using (company_id=public.current_company_id() and public.is_company_manager(company_id))
  with check (company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Members read channel request events"
  on public.attendance_channel_events for select to authenticated
  using (company_id=public.current_company_id() and exists (
    select 1 from public.attendance_channel_requests request
    where request.id=request_id and (request.profile_id=auth.uid() or public.is_company_manager(request.company_id))
  ));

revoke insert,delete on public.attendance_channel_requests from anon,authenticated;
revoke insert,update,delete on public.attendance_channel_events from anon,authenticated;

create or replace function public.submit_web_attendance_channel_request(
  request_action text,
  request_site_id uuid,
  request_latitude double precision default null,
  request_longitude double precision default null,
  request_accuracy_meters double precision default null,
  request_selfie_path text default null,
  request_note text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); request_id uuid; missing text[]:='{}';
begin
  if auth.uid() is null or company is null then raise exception 'not_authenticated_or_company_missing'; end if;
  if request_action not in ('clock_in','clock_out') then raise exception 'invalid_attendance_action'; end if;
  if request_site_id is null or not exists(select 1 from public.project_sites where id=request_site_id and company_id=company) then
    raise exception 'site_not_in_current_company';
  end if;
  if request_latitude is null or request_longitude is null then missing:=array_append(missing,'location'); end if;
  if nullif(trim(coalesce(request_selfie_path,'')),'') is null then missing:=array_append(missing,'selfie'); end if;
  insert into public.attendance_channel_requests(company_id,channel,profile_id,site_id,action,latitude,longitude,accuracy_meters,selfie_path,note,missing_fields,status)
  values(company,'web',auth.uid(),request_site_id,request_action,request_latitude,request_longitude,request_accuracy_meters,request_selfie_path,nullif(trim(coalesce(request_note,'')),''),missing,case when cardinality(missing)>0 then 'information_required' else 'awaiting_confirmation' end)
  returning id into request_id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,details)
  values(company,request_id,auth.uid(),'received',jsonb_build_object('channel','web','missing_fields',missing));
  return request_id;
end $$;
revoke all on function public.submit_web_attendance_channel_request(text,uuid,double precision,double precision,double precision,text,text) from public;
grant execute on function public.submit_web_attendance_channel_request(text,uuid,double precision,double precision,double precision,text,text) to authenticated;

create or replace function public.sync_line_attendance_channel_request() returns trigger language plpgsql security definer set search_path=public as $$
declare unified_status text; unified_id uuid;
begin
  unified_status:=case new.status
    when 'awaiting_employee_confirmation' then 'awaiting_confirmation'
    when 'pending_approval' then 'pending_review'
    when 'more_info_requested' then 'information_required'
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'expired' then 'expired'
    else 'failed' end;
  insert into public.attendance_channel_requests(company_id,channel,external_event_id,external_user_id,external_chat_id,profile_id,site_id,attendance_session_id,action,requested_at,status,confirmed_at,decided_by,decided_at,decision_reason,source_payload,updated_at)
  values(new.company_id,'line',new.id::text,new.requester_line_user_id,new.line_group_id,new.profile_id,new.site_id,new.attendance_session_id,new.action,new.requested_at,unified_status,new.employee_confirmed_at,new.decision_by,new.decision_at,new.decision_reason,jsonb_build_object('line_request_id',new.id),now())
  on conflict(channel,external_event_id) where external_event_id is not null do update set
    attendance_session_id=excluded.attendance_session_id,status=excluded.status,confirmed_at=excluded.confirmed_at,
    decided_by=excluded.decided_by,decided_at=excluded.decided_at,decision_reason=excluded.decision_reason,updated_at=now()
  returning id into unified_id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,details)
  values(new.company_id,unified_id,new.decision_by,'line_status_synced',jsonb_build_object('line_status',new.status)) ;
  return new;
end $$;

drop trigger if exists sync_line_attendance_channel_request_trigger on public.line_attendance_requests;
create trigger sync_line_attendance_channel_request_trigger after insert or update on public.line_attendance_requests
for each row execute function public.sync_line_attendance_channel_request();

insert into public.attendance_channel_requests(company_id,channel,external_event_id,external_user_id,external_chat_id,profile_id,site_id,attendance_session_id,action,requested_at,status,confirmed_at,decided_by,decided_at,decision_reason,source_payload,updated_at)
select request.company_id,'line',request.id::text,request.requester_line_user_id,request.line_group_id,request.profile_id,request.site_id,request.attendance_session_id,request.action,request.requested_at,
  case request.status when 'awaiting_employee_confirmation' then 'awaiting_confirmation' when 'pending_approval' then 'pending_review' when 'more_info_requested' then 'information_required' when 'approved' then 'approved' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' when 'expired' then 'expired' else 'failed' end,
  request.employee_confirmed_at,request.decision_by,request.decision_at,request.decision_reason,jsonb_build_object('line_request_id',request.id),request.updated_at
from public.line_attendance_requests request
on conflict(channel,external_event_id) where external_event_id is not null do nothing;

update public.system_work_items set status='doing',progress=45,detail='Unified tenant-safe attendance channel ledger, Web RPC, and LINE synchronization prepared.',production_status='migration_ready_for_production',updated_at=now() where work_key='ATT-CHANNEL-001';
