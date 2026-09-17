-- ATTENDANCE-MOBILE-FLOW-V2: validate GPS before geofence and keep exceptions
-- outside attendance_sessions until an authorised manager approves them.

alter table public.employee_site_assignments
  add column if not exists attendance_required_override boolean;
alter table public.employee_employment_records
  add column if not exists attendance_required_override boolean;
alter table public.work_policies
  add column if not exists attendance_required boolean not null default true,
  add column if not exists require_attendance_selfie boolean not null default true;
alter table public.attendance_system_settings
  add column if not exists attendance_required_default boolean not null default true,
  add column if not exists gps_evidence_ttl_seconds integer not null default 90
    check (gps_evidence_ttl_seconds between 30 and 300),
  add column if not exists selfie_retention_days integer not null default 90
    check (selfie_retention_days between 1 and 3650);
alter table public.attendance_sessions
  add column if not exists selfie_retain_until timestamptz,
  add column if not exists selfie_legal_hold_until timestamptz;

create or replace function public.set_attendance_selfie_retention()
returns trigger language plpgsql set search_path=public as $$
declare retention_days integer;
begin
  if (new.clock_in_selfie_path is not null or new.clock_out_selfie_path is not null) and new.selfie_retain_until is null then
    select coalesce(s.selfie_retention_days,90) into retention_days from public.attendance_system_settings s
      where s.company_id=new.company_id and s.singleton;
    new.selfie_retain_until:=now()+make_interval(days=>coalesce(retention_days,90));
  end if;
  return new;
end $$;
drop trigger if exists set_attendance_selfie_retention_trigger on public.attendance_sessions;
create trigger set_attendance_selfie_retention_trigger before insert or update of clock_in_selfie_path,clock_out_selfie_path
on public.attendance_sessions for each row execute function public.set_attendance_selfie_retention();

alter table public.attendance_channel_requests
  add column if not exists request_kind text not null default 'attendance'
    check (request_kind in ('attendance','location_exception','offline_recovery')),
  add column if not exists exception_code text,
  add column if not exists distance_meters double precision,
  add column if not exists evidence_captured_at timestamptz,
  add column if not exists evidence_expires_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists command_fingerprint text,
  add column if not exists claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists policy_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists device_info jsonb not null default '{}'::jsonb;
alter table public.attendance_channel_requests
  add column if not exists evidence_revision integer not null default 1 check(evidence_revision>0),
  add column if not exists revision_required boolean not null default false,
  add column if not exists review_due_at timestamptz,
  add column if not exists claim_lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_count integer not null default 0;
alter table public.attendance_channel_events add column if not exists event_key text;
create unique index if not exists attendance_channel_event_key_unique
  on public.attendance_channel_events(request_id,event_key) where event_key is not null;

drop policy if exists "Managers update channel requests" on public.attendance_channel_requests;
revoke update on public.attendance_channel_requests from authenticated;

create or replace function public.can_review_attendance_site(target_company_id uuid,target_site_id uuid,target_profile_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=target_profile_id
    and m.active and (m.ends_on is null or m.ends_on>=current_date) and (
      m.company_role in ('company_admin','executive','manager') or
      (m.company_role='site_supervisor' and exists(select 1 from public.project_sites s
        join public.project_members pm on pm.project_id=s.project_id and pm.profile_id=target_profile_id
        where s.company_id=target_company_id and s.id=target_site_id and pm.member_role in ('owner','manager')))
    ))
$$;
revoke all on function public.can_review_attendance_site(uuid,uuid,uuid) from public,anon;
grant execute on function public.can_review_attendance_site(uuid,uuid,uuid) to authenticated,service_role;

alter table public.attendance_channel_requests drop constraint if exists attendance_channel_requests_status_check;
alter table public.attendance_channel_requests add constraint attendance_channel_requests_status_check check (status in (
  'identity_required','information_required','awaiting_confirmation','pending_review','claimed',
  'approved','attendance_recorded','rejected','cancelled','expired','failed'
));

create unique index if not exists attendance_channel_request_idempotency_unique
  on public.attendance_channel_requests(company_id,channel,idempotency_key)
  where idempotency_key is not null;

create or replace function public.guard_attendance_exception_evidence()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.request_kind='location_exception' and current_user not in ('postgres','service_role') and (
    new.company_id is distinct from old.company_id or new.profile_id is distinct from old.profile_id
    or new.site_id is distinct from old.site_id or new.action is distinct from old.action
    or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude
    or new.accuracy_meters is distinct from old.accuracy_meters or new.distance_meters is distinct from old.distance_meters
    or new.evidence_captured_at is distinct from old.evidence_captured_at or new.evidence_expires_at is distinct from old.evidence_expires_at
    or new.idempotency_key is distinct from old.idempotency_key or new.command_fingerprint is distinct from old.command_fingerprint
    or new.policy_snapshot is distinct from old.policy_snapshot
  ) then raise exception 'sealed_attendance_exception_evidence'; end if;
  return new;
end $$;
drop trigger if exists guard_attendance_exception_evidence_trigger on public.attendance_channel_requests;
create trigger guard_attendance_exception_evidence_trigger before update on public.attendance_channel_requests
for each row execute function public.guard_attendance_exception_evidence();

alter table public.attendance_approval_events
  add column if not exists request_id uuid references public.attendance_channel_requests(id) on delete restrict;
alter table public.attendance_approval_events alter column session_id drop not null;
alter table public.attendance_approval_events drop constraint if exists attendance_approval_events_target_check;
alter table public.attendance_approval_events add constraint attendance_approval_events_target_check
  check (num_nonnulls(session_id,request_id)=1);

create or replace function public.resolve_attendance_mobile_policy(
  target_company_id uuid,
  target_profile_id uuid,
  target_site_id uuid
) returns jsonb language sql stable security definer set search_path=public as $$
  with context as (
    select e.attendance_required_override employee_override,e.attendance_policy,e.work_policy_id employee_policy_id,
      a.attendance_required_override assignment_override,a.work_policy_id assignment_policy_id,
      s.work_policy_id site_policy_id
    from public.employee_employment_records e
    left join lateral (
      select x.* from public.employee_site_assignments x
      where x.company_id=target_company_id and x.profile_id=target_profile_id and x.site_id=target_site_id
        and x.active and x.starts_on<=current_date and (x.ends_on is null or x.ends_on>=current_date)
      order by x.starts_on desc limit 1
    ) a on true
    left join public.project_sites s on s.company_id=target_company_id and s.id=target_site_id
    where e.company_id=target_company_id and e.profile_id=target_profile_id
      and (current_user in ('service_role','postgres') or (target_company_id=public.current_company_id() and target_profile_id=auth.uid()))
  ), resolved as (
    select c.*,coalesce(c.assignment_policy_id,c.employee_policy_id,c.site_policy_id) resolved_policy_id
    from context c
  )
  select jsonb_build_object(
    'attendance_required',coalesce(r.employee_override,r.assignment_override,
      case when r.attendance_policy='exempt' then false else null end,p.attendance_required,settings.attendance_required_default,true),
    'attendance_required_source',case when r.employee_override is not null then 'employee' when r.assignment_override is not null then 'assignment'
      when r.attendance_policy='exempt' then 'legacy_employment' when p.id is not null then 'work_policy' else 'company' end,
    'require_selfie',coalesce(p.require_attendance_selfie,true),
    'work_policy_id',p.id,'work_policy_name',p.name,
    'gps_evidence_ttl_seconds',coalesce(settings.gps_evidence_ttl_seconds,90),
    'selfie_retention_days',coalesce(settings.selfie_retention_days,90)
  )
  from resolved r
  left join public.work_policies p on p.company_id=target_company_id and p.id=r.resolved_policy_id
  left join public.attendance_system_settings settings on settings.company_id=target_company_id and settings.singleton
$$;
revoke all on function public.resolve_attendance_mobile_policy(uuid,uuid,uuid) from public,anon;
grant execute on function public.resolve_attendance_mobile_policy(uuid,uuid,uuid) to authenticated,service_role;

create or replace function public.create_attendance_location_exception(
  request_action text,
  request_site_id uuid,
  request_latitude double precision,
  request_longitude double precision,
  request_accuracy_meters double precision,
  request_evidence_captured_at timestamptz,
  request_idempotency_key text,
  request_note text default null,
  request_device_info jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  company uuid:=public.current_company_id(); site public.project_sites; settings public.attendance_system_settings;
  policy jsonb; calculated_distance double precision; result_id uuid; fingerprint text;
begin
  if auth.uid() is null or company is null then raise exception 'not_authenticated_or_company_missing'; end if;
  if request_action not in ('clock_in','clock_out') then raise exception 'invalid_attendance_action'; end if;
  if request_latitude is null or request_longitude is null or request_accuracy_meters is null
    or request_latitude::text in ('NaN','Infinity','-Infinity') or request_longitude::text in ('NaN','Infinity','-Infinity')
    or request_accuracy_meters::text in ('NaN','Infinity','-Infinity') or request_latitude not between -90 and 90
    or request_longitude not between -180 and 180 or request_accuracy_meters<0 then raise exception 'gps_evidence_invalid'; end if;
  if request_idempotency_key is null or length(trim(request_idempotency_key))<12 then raise exception 'idempotency_key_required'; end if;
  select * into site from public.project_sites where company_id=company and id=request_site_id and active;
  if site.id is null then raise exception 'site_not_assigned'; end if;
  if not exists(select 1 from public.employee_site_assignments a where a.company_id=company and a.profile_id=auth.uid()
    and a.site_id=site.id and a.active and a.starts_on<=current_date and (a.ends_on is null or a.ends_on>=current_date))
    and not public.is_company_manager(company) then raise exception 'site_not_assigned'; end if;
  select * into settings from public.attendance_system_settings where company_id=company and singleton;
  if request_accuracy_meters is null or request_accuracy_meters>coalesce(settings.max_gps_accuracy_meters,200)
    then raise exception 'gps_accuracy_insufficient'; end if;
  if request_evidence_captured_at is null or request_evidence_captured_at<now()-make_interval(secs=>coalesce(settings.gps_evidence_ttl_seconds,90))
    or request_evidence_captured_at>now()+interval '10 seconds' then raise exception 'gps_evidence_expired'; end if;
  calculated_distance:=6371000*2*asin(sqrt(power(sin(radians(request_latitude-site.latitude)/2),2)
    +cos(radians(site.latitude))*cos(radians(request_latitude))*power(sin(radians(request_longitude-site.longitude)/2),2)));
  if calculated_distance<=site.radius_meters then raise exception 'location_is_inside_geofence'; end if;
  policy:=public.resolve_attendance_mobile_policy(company,auth.uid(),site.id);
  if not coalesce((policy->>'attendance_required')::boolean,true) then raise exception 'attendance_not_required'; end if;
  fingerprint:=encode(digest(concat_ws('|',company,auth.uid(),request_action,site.id,request_latitude,request_longitude,request_accuracy_meters,request_evidence_captured_at),'sha256'),'hex');
  insert into public.attendance_channel_requests(company_id,channel,profile_id,site_id,action,latitude,longitude,
    accuracy_meters,note,status,request_kind,exception_code,distance_meters,evidence_captured_at,evidence_expires_at,
    idempotency_key,command_fingerprint,policy_snapshot,device_info,source_payload)
  values(company,'web',auth.uid(),site.id,request_action,request_latitude,request_longitude,request_accuracy_meters,
    nullif(trim(coalesce(request_note,'')),''),'pending_review','location_exception','outside_geofence',calculated_distance,
    request_evidence_captured_at,request_evidence_captured_at+make_interval(secs=>coalesce(settings.gps_evidence_ttl_seconds,90)),
    trim(request_idempotency_key),fingerprint,policy,coalesce(request_device_info,'{}'::jsonb),jsonb_build_object('sealed',true))
  on conflict(company_id,channel,idempotency_key) where idempotency_key is not null do update set updated_at=attendance_channel_requests.updated_at
  returning id into result_id;
  if (select command_fingerprint from public.attendance_channel_requests where id=result_id)<>fingerprint then raise exception 'idempotency_fingerprint_conflict'; end if;
  update public.attendance_channel_requests set review_due_at=coalesce(review_due_at,now()+interval '30 minutes') where id=result_id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    values(company,result_id,auth.uid(),'location_exception_submitted','submitted:1',jsonb_build_object('distance_meters',round(calculated_distance::numeric,1),'evidence_sealed',true))
    on conflict(request_id,event_key) where event_key is not null do nothing;
  return result_id;
end $$;
revoke all on function public.create_attendance_location_exception(text,uuid,double precision,double precision,double precision,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.create_attendance_location_exception(text,uuid,double precision,double precision,double precision,timestamptz,text,text,jsonb) to authenticated;

create or replace function public.review_attendance_location_exception(
  target_request_id uuid,
  review_action text,
  review_reason text
) returns text language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); item public.attendance_channel_requests; new_status text;
begin
  if auth.uid() is null or company is null then raise exception 'manager_required'; end if;
  if review_action not in ('approve','reject','request_more') then raise exception 'invalid_review_action'; end if;
  if nullif(trim(coalesce(review_reason,'')),'') is null then raise exception 'review_reason_required'; end if;
  select * into item from public.attendance_channel_requests where company_id=company and id=target_request_id for update;
  if item.id is null or item.request_kind<>'location_exception' then raise exception 'exception_not_found'; end if;
  if not public.can_review_attendance_site(company,item.site_id,auth.uid()) then raise exception 'site_review_authority_required'; end if;
  if item.profile_id=auth.uid() then raise exception 'self_approval_forbidden'; end if;
  if item.status not in ('pending_review','claimed','information_required') then
    if item.status in ('approved','rejected') then return item.status; end if;
    raise exception 'exception_not_reviewable';
  end if;
  if review_action='approve' and item.revision_required then raise exception 'new_sealed_revision_required'; end if;
  if item.site_id is null or not exists(select 1 from public.project_sites s where s.company_id=company and s.id=item.site_id) then raise exception 'site_scope_invalid'; end if;
  new_status:=case review_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'information_required' end;
  update public.attendance_channel_requests set status=new_status,decided_by=auth.uid(),decided_at=now(),
    approved_at=case when review_action='approve' then now() else approved_at end,decision_reason=trim(review_reason),updated_at=now()
    ,revision_required=case when review_action='request_more' then true else revision_required end
  where id=item.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    values(company,item.id,auth.uid(),'location_exception_'||review_action,'review:'||item.evidence_revision||':'||review_action,jsonb_build_object('reason',trim(review_reason)))
    on conflict(request_id,event_key) where event_key is not null do nothing;
  insert into public.attendance_approval_events(company_id,session_id,request_id,actor_profile_id,source,action,reason,old_status,new_status)
    values(company,null,item.id,auth.uid(),'web',review_action,trim(review_reason),item.status,new_status);
  return new_status;
end $$;
revoke all on function public.review_attendance_location_exception(uuid,text,text) from public,anon;
grant execute on function public.review_attendance_location_exception(uuid,text,text) to authenticated;

create or replace function public.claim_attendance_location_exception(target_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); item public.attendance_channel_requests;
begin
  select * into item from public.attendance_channel_requests where company_id=company and id=target_request_id for update;
  if item.id is null or item.status<>'pending_review' then return false; end if;
  if not public.can_review_attendance_site(company,item.site_id,auth.uid()) or item.profile_id=auth.uid() then raise exception 'site_review_authority_required'; end if;
  update public.attendance_channel_requests set status='claimed',claimed_by=auth.uid(),claimed_at=now(),heartbeat_at=now(),claim_lease_expires_at=now()+interval '15 minutes',updated_at=now() where id=item.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    values(company,item.id,auth.uid(),'location_exception_claimed','claim:'||item.evidence_revision,'{}')
    on conflict(request_id,event_key) where event_key is not null do nothing;
  return true;
end $$;
revoke all on function public.claim_attendance_location_exception(uuid) from public,anon;
grant execute on function public.claim_attendance_location_exception(uuid) to authenticated;

create or replace function public.resubmit_attendance_location_exception(
  target_request_id uuid,request_latitude double precision,request_longitude double precision,
  request_accuracy_meters double precision,request_evidence_captured_at timestamptz,request_note text default null
) returns integer language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); item public.attendance_channel_requests; site public.project_sites; settings public.attendance_system_settings;
  calculated_distance double precision; fingerprint text; next_revision integer;
begin
  select * into item from public.attendance_channel_requests where company_id=company and id=target_request_id and profile_id=auth.uid() for update;
  if item.id is null or item.status<>'information_required' or not item.revision_required then raise exception 'resubmit_not_allowed'; end if;
  select * into site from public.project_sites where company_id=company and id=item.site_id and active;
  select * into settings from public.attendance_system_settings where company_id=company and singleton;
  if request_latitude is null or request_longitude is null or request_accuracy_meters is null
    or request_latitude::text in ('NaN','Infinity','-Infinity') or request_longitude::text in ('NaN','Infinity','-Infinity')
    or request_accuracy_meters::text in ('NaN','Infinity','-Infinity') or request_latitude not between -90 and 90 or request_longitude not between -180 and 180
    or request_accuracy_meters<0 or request_accuracy_meters>coalesce(settings.max_gps_accuracy_meters,200)
    then raise exception 'gps_evidence_invalid'; end if;
  if request_evidence_captured_at<now()-make_interval(secs=>coalesce(settings.gps_evidence_ttl_seconds,90)) or request_evidence_captured_at>now()+interval '10 seconds' then raise exception 'gps_evidence_expired'; end if;
  calculated_distance:=6371000*2*asin(sqrt(power(sin(radians(request_latitude-site.latitude)/2),2)+cos(radians(site.latitude))*cos(radians(request_latitude))*power(sin(radians(request_longitude-site.longitude)/2),2)));
  if calculated_distance<=site.radius_meters then raise exception 'location_is_inside_geofence_use_normal_flow'; end if;
  fingerprint:=encode(digest(concat_ws('|',company,auth.uid(),item.action,site.id,request_latitude,request_longitude,request_accuracy_meters,request_evidence_captured_at),'sha256'),'hex');
  if fingerprint=item.command_fingerprint then raise exception 'unchanged_evidence_revision'; end if;
  next_revision:=item.evidence_revision+1;
  update public.attendance_channel_requests set latitude=request_latitude,longitude=request_longitude,accuracy_meters=request_accuracy_meters,
    distance_meters=calculated_distance,evidence_captured_at=request_evidence_captured_at,
    evidence_expires_at=request_evidence_captured_at+make_interval(secs=>coalesce(settings.gps_evidence_ttl_seconds,90)),
    command_fingerprint=fingerprint,evidence_revision=next_revision,revision_required=false,status='pending_review',
    note=nullif(trim(coalesce(request_note,'')),''),decided_by=null,decided_at=null,decision_reason=null,approved_at=null,
    claimed_by=null,claimed_at=null,review_due_at=now()+interval '30 minutes',updated_at=now() where id=item.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    values(company,item.id,auth.uid(),'location_exception_resubmitted','submitted:'||next_revision,jsonb_build_object('revision',next_revision))
    on conflict(request_id,event_key) where event_key is not null do nothing;
  return next_revision;
end $$;
revoke all on function public.resubmit_attendance_location_exception(uuid,double precision,double precision,double precision,timestamptz,text) from public,anon;
grant execute on function public.resubmit_attendance_location_exception(uuid,double precision,double precision,double precision,timestamptz,text) to authenticated;

create or replace function public.finalize_approved_attendance_exception(
  target_request_id uuid,
  target_selfie_path text default null
) returns table(session_id uuid,result_status text) language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); item public.attendance_channel_requests; created_id uuid; open_row public.attendance_sessions;
  require_selfie boolean; now_value timestamptz:=now();
begin
  if auth.uid() is null or company is null then raise exception 'not_authenticated_or_company_missing'; end if;
  select * into item from public.attendance_channel_requests where company_id=company and id=target_request_id for update;
  if item.id is null or item.profile_id<>auth.uid() or item.request_kind<>'location_exception' then raise exception 'approved_exception_not_found'; end if;
  if item.status='attendance_recorded' and item.attendance_session_id is not null then return query select item.attendance_session_id,'normal'::text; return; end if;
  if item.status<>'approved' then raise exception 'exception_not_approved'; end if;
  require_selfie:=coalesce((item.policy_snapshot->>'require_selfie')::boolean,true);
  if require_selfie and nullif(trim(coalesce(target_selfie_path,'')),'') is null then raise exception 'selfie_required'; end if;
  if target_selfie_path is not null and (target_selfie_path not like auth.uid()::text||'/%' or target_selfie_path like '%..%') then raise exception 'selfie_owner_mismatch'; end if;
  if target_selfie_path is not null and not exists(select 1 from storage.objects o where o.bucket_id='attendance-selfies' and o.name=target_selfie_path)
    then raise exception 'selfie_not_found'; end if;
  if item.action='clock_in' then
    if exists(select 1 from public.attendance_sessions s where s.company_id=company and s.profile_id=auth.uid() and s.clock_out_at is null and s.status not in ('rejected','duplicate'))
      then raise exception 'open_attendance_exists'; end if;
    insert into public.attendance_sessions(company_id,profile_id,site_id,clock_in_at,clock_in_latitude,clock_in_longitude,
      clock_in_accuracy_meters,clock_in_distance_meters,clock_in_selfie_path,status,policy_snapshot,review_reason,review_category,reviewed_by,reviewed_at)
    values(company,auth.uid(),item.site_id,now_value,item.latitude,item.longitude,item.accuracy_meters,item.distance_meters,target_selfie_path,
      'approved',item.policy_snapshot,'อนุมัติลงเวลาเข้านอกพื้นที่: '||coalesce(item.decision_reason,'-'),'gps_outside',item.decided_by,item.decided_at)
    returning id into created_id;
  else
    select * into open_row from public.attendance_sessions s where s.company_id=company and s.profile_id=auth.uid()
      and s.clock_out_at is null and s.status not in ('rejected','duplicate') order by s.clock_in_at desc limit 1 for update;
    if open_row.id is null then raise exception 'open_attendance_not_found'; end if;
    update public.attendance_sessions set clock_out_at=now_value,clock_out_latitude=item.latitude,clock_out_longitude=item.longitude,
      clock_out_accuracy_meters=item.accuracy_meters,clock_out_distance_meters=item.distance_meters,clock_out_selfie_path=target_selfie_path,
      status='approved',review_reason=concat_ws(' · ',review_reason,'อนุมัติลงเวลาออกนอกพื้นที่: '||coalesce(item.decision_reason,'-')),
      review_category=case when review_category is null then 'gps_outside' else 'multiple' end,reviewed_by=item.decided_by,reviewed_at=item.decided_at,updated_at=now_value
    where id=open_row.id returning id into created_id;
  end if;
  update public.attendance_channel_requests set attendance_session_id=created_id,status='attendance_recorded',selfie_path=target_selfie_path,
    confirmed_at=now_value,updated_at=now_value where id=item.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,details)
    values(company,item.id,auth.uid(),'attendance_recorded',jsonb_build_object('session_id',created_id));
  insert into public.attendance_notifications(session_id,event_type,channel,status,reason)
    values(created_id,item.action,'line','queued','attendance_exception_finalized')
    on conflict(session_id,event_type,channel) do nothing;
  return query select created_id,'approved'::text;
end $$;
revoke all on function public.finalize_approved_attendance_exception(uuid,text) from public,anon;
grant execute on function public.finalize_approved_attendance_exception(uuid,text) to authenticated;

comment on function public.create_attendance_location_exception(text,uuid,double precision,double precision,double precision,timestamptz,text,text,jsonb)
  is 'Seals accurate outside-geofence evidence within the configured 90-second window without creating attendance.';

alter table public.attendance_channel_requests
  add column if not exists claim_lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalation_count integer not null default 0;

create or replace function public.renew_attendance_exception_claim(target_request_id uuid,lease_minutes integer default 15)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if lease_minutes not between 1 and 60 then raise exception 'invalid_lease'; end if;
  update public.attendance_channel_requests set heartbeat_at=now(),claim_lease_expires_at=now()+make_interval(mins=>lease_minutes),updated_at=now()
  where id=target_request_id and company_id=public.current_company_id() and claimed_by=auth.uid() and status='claimed';
  return found;
end $$;
revoke all on function public.renew_attendance_exception_claim(uuid,integer) from public,anon;
grant execute on function public.renew_attendance_exception_claim(uuid,integer) to authenticated;

create or replace function public.release_attendance_exception_claim(target_request_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.attendance_channel_requests set status='pending_review',claimed_by=null,claimed_at=null,claim_lease_expires_at=null,heartbeat_at=null,updated_at=now()
  where id=target_request_id and company_id=public.current_company_id() and claimed_by=auth.uid() and status='claimed';
  return found;
end $$;
revoke all on function public.release_attendance_exception_claim(uuid) from public,anon;
grant execute on function public.release_attendance_exception_claim(uuid) to authenticated;

create or replace function public.escalate_overdue_attendance_exceptions()
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  with overdue as (
    update public.attendance_channel_requests set escalated_at=now(),escalation_count=escalation_count+1,updated_at=now()
    where request_kind='location_exception' and status in ('pending_review','claimed') and review_due_at<now()
      and (escalated_at is null or escalated_at<now()-interval '30 minutes') returning *
  ) insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    select company_id,id,null,'location_exception_sla_escalated','sla:'||(escalation_count+1),jsonb_build_object('review_due_at',review_due_at,'status',status)
    from overdue on conflict(request_id,event_key) where event_key is not null do nothing;
  get diagnostics affected=row_count; return affected;
end $$;
revoke all on function public.escalate_overdue_attendance_exceptions() from public,anon,authenticated;
grant execute on function public.escalate_overdue_attendance_exceptions() to service_role;

create or replace view public.attendance_mobile_monitor_v1 with (security_invoker=true) as
select company_id,
  count(*) filter(where exception_code='gps_inaccurate') gps_inaccurate,
  count(*) filter(where exception_code='outside_geofence') outside_geofence,
  count(*) filter(where status in ('pending_review','claimed')) pending_review,
  count(*) filter(where status in ('pending_review','claimed') and review_due_at<now()) overdue_sla,
  count(*) filter(where status='information_required') information_required,
  count(*) filter(where status='attendance_recorded') attendance_recorded,
  count(*) filter(where status='failed') failed
from public.attendance_channel_requests where request_kind in ('location_exception','offline_recovery') group by company_id;
grant select on public.attendance_mobile_monitor_v1 to authenticated;

create table if not exists public.attendance_selfie_retention_events(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete restrict,
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,selfie_path text not null,
  action text not null check(action in ('purged','skipped_legal_hold','failed')),reason text,created_at timestamptz not null default now(),
  unique(session_id,selfie_path,action)
);
create table if not exists public.attendance_selfie_access_events(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete restrict,
  session_id uuid not null references public.attendance_sessions(id) on delete restrict,actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  selfie_path text not null,access_reason text not null,created_at timestamptz not null default now()
);
alter table public.attendance_selfie_access_events enable row level security;
create policy "Scoped HR reads selfie access events" on public.attendance_selfie_access_events for select to authenticated
using(company_id=public.current_company_id() and public.is_company_manager(company_id));
alter table public.attendance_selfie_retention_events enable row level security;
create policy "Scoped HR reads selfie retention events" on public.attendance_selfie_retention_events for select to authenticated
using(company_id=public.current_company_id() and public.is_company_manager(company_id));

create or replace function public.purge_expired_attendance_selfies(batch_size integer default 100)
returns integer language plpgsql security definer set search_path=public,storage as $$
declare item record; purged integer:=0;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service_role_required'; end if;
  for item in
    select s.id,s.company_id,path.selfie_path from public.attendance_sessions s
    cross join lateral (values(s.clock_in_selfie_path),(s.clock_out_selfie_path)) path(selfie_path)
    where path.selfie_path is not null and s.selfie_retain_until<=now()
      and (s.selfie_legal_hold_until is null or s.selfie_legal_hold_until<now())
      and not exists(select 1 from public.attendance_selfie_retention_events e where e.session_id=s.id and e.selfie_path=path.selfie_path and e.action='purged')
    order by s.selfie_retain_until limit greatest(1,least(batch_size,500))
  loop
    delete from storage.objects where bucket_id='attendance-selfies' and name=item.selfie_path;
    insert into public.attendance_selfie_retention_events(company_id,session_id,selfie_path,action,reason)
      values(item.company_id,item.id,item.selfie_path,'purged','90-day retention expired') on conflict do nothing;
    purged:=purged+1;
  end loop;
  return purged;
end $$;
revoke all on function public.purge_expired_attendance_selfies(integer) from public,anon,authenticated;
grant execute on function public.purge_expired_attendance_selfies(integer) to service_role;

drop policy if exists "Attendance selfies readable by tenant owner or manager" on storage.objects;
create policy "Attendance selfies readable by owner or scoped attendance reviewer" on storage.objects for select to authenticated using (
  bucket_id='attendance-selfies' and (
    (storage.foldername(name))[1]=auth.uid()::text
    or ((storage.foldername(name))[1]=public.current_company_id()::text and (
      (storage.foldername(name))[2]=auth.uid()::text or exists(
        select 1 from public.attendance_channel_requests r where r.company_id=public.current_company_id()
          and r.profile_id::text=(storage.foldername(name))[2] and r.site_id is not null
          and public.can_review_attendance_site(r.company_id,r.site_id,auth.uid())
      )))
  )
);

create extension if not exists pg_cron;
do $$ begin
  if not exists(select 1 from cron.job where jobname='wisdomai-attendance-v2-maintenance') then
    perform cron.schedule('wisdomai-attendance-v2-maintenance','17 * * * *',
      $job$select public.escalate_overdue_attendance_exceptions(); select public.purge_expired_attendance_selfies(100);$job$);
  end if;
end $$;

-- Compatibility adapters: LINE/Telegram must enter the same canonical ledger.
-- The historical signatures remain callable, but outside/inaccurate evidence no longer creates needs_review attendance.
create or replace function public.finalize_telegram_attendance_request(target_request_id uuid)
returns table(session_id uuid,result_status text,distance_meters double precision)
language plpgsql security definer set search_path=public as $$
declare req public.attendance_channel_requests; site public.project_sites; settings public.attendance_system_settings;
  distance_value double precision; policy jsonb; created_id uuid; captured_at timestamptz;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service_role_required'; end if;
  select * into req from public.attendance_channel_requests where id=target_request_id for update;
  if req.id is null or req.channel<>'telegram' then raise exception 'telegram_request_not_found'; end if;
  if req.status not in ('information_required','awaiting_confirmation') then raise exception 'request_not_actionable'; end if;
  if req.profile_id is null or req.site_id is null then raise exception 'request_information_incomplete'; end if;
  select * into site from public.project_sites where id=req.site_id and company_id=req.company_id and active;
  select * into settings from public.attendance_system_settings where company_id=req.company_id and singleton;
  if req.latitude is null or req.longitude is null or req.accuracy_meters is null
    or req.latitude::text in ('NaN','Infinity','-Infinity') or req.longitude::text in ('NaN','Infinity','-Infinity')
    or req.accuracy_meters::text in ('NaN','Infinity','-Infinity') or req.latitude not between -90 and 90 or req.longitude not between -180 and 180
    or req.accuracy_meters<0 or req.accuracy_meters>coalesce(settings.max_gps_accuracy_meters,200) then
    update public.attendance_channel_requests set status='information_required',missing_fields=array['accurate_location'],updated_at=now() where id=req.id;
    return query select null::uuid,'gps_inaccurate'::text,null::double precision; return;
  end if;
  captured_at:=coalesce(req.evidence_captured_at,req.updated_at,now());
  distance_value:=6371000*2*asin(sqrt(power(sin(radians(req.latitude-site.latitude)/2),2)+cos(radians(site.latitude))*cos(radians(req.latitude))*power(sin(radians(req.longitude-site.longitude)/2),2)));
  policy:=public.resolve_attendance_mobile_policy(req.company_id,req.profile_id,site.id);
  if not coalesce((policy->>'attendance_required')::boolean,true) then raise exception 'attendance_not_required'; end if;
  if distance_value>site.radius_meters then
    update public.attendance_channel_requests set request_kind='location_exception',exception_code='outside_geofence',distance_meters=distance_value,
      evidence_captured_at=captured_at,evidence_expires_at=captured_at+make_interval(secs=>coalesce(settings.gps_evidence_ttl_seconds,90)),
      policy_snapshot=policy,status='pending_review',review_due_at=now()+interval '30 minutes',updated_at=now() where id=req.id;
    insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
      values(req.company_id,req.id,req.profile_id,'location_exception_submitted','submitted:1',jsonb_build_object('channel','telegram','distance_meters',distance_value))
      on conflict(request_id,event_key) where event_key is not null do nothing;
    return query select null::uuid,'pending_review'::text,distance_value; return;
  end if;
  if coalesce((policy->>'require_selfie')::boolean,true) and req.selfie_path is null then raise exception 'selfie_required_after_gps_validation'; end if;
  if req.action='clock_in' then
    insert into public.attendance_sessions(company_id,profile_id,site_id,clock_in_at,clock_in_latitude,clock_in_longitude,clock_in_accuracy_meters,clock_in_distance_meters,clock_in_selfie_path,status,policy_snapshot)
      values(req.company_id,req.profile_id,site.id,now(),req.latitude,req.longitude,req.accuracy_meters,distance_value,req.selfie_path,'normal',policy) returning id into created_id;
  else
    update public.attendance_sessions set clock_out_at=now(),clock_out_latitude=req.latitude,clock_out_longitude=req.longitude,clock_out_accuracy_meters=req.accuracy_meters,
      clock_out_distance_meters=distance_value,clock_out_selfie_path=req.selfie_path,updated_at=now()
      where id=(select id from public.attendance_sessions where company_id=req.company_id and profile_id=req.profile_id and clock_out_at is null and status not in ('rejected','duplicate') order by clock_in_at desc limit 1 for update)
      returning id into created_id;
    if created_id is null then raise exception 'open_attendance_not_found'; end if;
  end if;
  update public.attendance_channel_requests set attendance_session_id=created_id,status='attendance_recorded',confirmed_at=now(),policy_snapshot=policy,updated_at=now() where id=req.id;
  insert into public.attendance_notifications(session_id,event_type,channel,status,reason) values(created_id,req.action,'line','queued','telegram_attendance_recorded') on conflict do nothing;
  return query select created_id,'normal'::text,distance_value;
end $$;
revoke all on function public.finalize_telegram_attendance_request(uuid) from public,anon,authenticated;
grant execute on function public.finalize_telegram_attendance_request(uuid) to service_role;

create or replace function public.review_telegram_attendance(target_session_id uuid,actor_profile_id uuid,review_action text)
returns table(session_id uuid,result_status text) language plpgsql security definer set search_path=public as $$
declare req public.attendance_channel_requests; status_result text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service_role_required'; end if;
  select * into req from public.attendance_channel_requests where id=target_session_id and channel='telegram' for update;
  if req.id is null then raise exception 'attendance_request_not_found'; end if;
  if req.profile_id=actor_profile_id or not public.can_review_attendance_site(req.company_id,req.site_id,actor_profile_id) then raise exception 'telegram_admin_not_authorized_for_site'; end if;
  if review_action not in ('approve','reject','request_more') then raise exception 'invalid_review_action'; end if;
  if review_action='approve' and req.revision_required then raise exception 'new_sealed_revision_required'; end if;
  status_result:=case review_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'information_required' end;
  update public.attendance_channel_requests set status=status_result,decided_by=actor_profile_id,decided_at=now(),
    approved_at=case when review_action='approve' then now() end,revision_required=(review_action='request_more'),updated_at=now() where id=req.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,event_key,details)
    values(req.company_id,req.id,actor_profile_id,'location_exception_'||review_action,'review:'||req.evidence_revision||':'||review_action,'{}')
    on conflict(request_id,event_key) where event_key is not null do nothing;
  return query select null::uuid,status_result;
end $$;
revoke all on function public.review_telegram_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_telegram_attendance(uuid,uuid,text) to service_role;
