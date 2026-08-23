-- CHAT-ATTENDANCE-APPROVAL-001: explicit approval and 100% completion gate.
create table public.chat_attendance_approval_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  request_code text not null,
  requester_profile_id uuid not null references public.profiles(id) on delete restrict,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  site_id uuid references public.project_sites(id) on delete restrict,
  action text not null check (action in ('clock_in','clock_out')),
  requested_at timestamptz not null,
  latitude numeric,
  longitude numeric,
  accuracy_meters numeric,
  selfie_path text,
  device_info jsonb not null default '{}'::jsonb,
  status text not null check (status in (
    'detected','prechecked','pending_approval','approved','recorded',
    'needs_more_info','rejected','closed'
  )),
  validation_result jsonb not null default '{}'::jsonb,
  duplicate_of_job_id uuid references public.chat_attendance_approval_jobs(id) on delete set null,
  attendance_session_id uuid references public.attendance_sessions(id) on delete set null,
  decision_note text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  recorded_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, request_code)
);

create table public.chat_attendance_approval_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.chat_attendance_approval_jobs(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index chat_attendance_approval_queue_idx
  on public.chat_attendance_approval_jobs(company_id, room_id, status, created_at desc);
create index chat_attendance_approval_event_job_idx
  on public.chat_attendance_approval_events(company_id, job_id, created_at);

alter table public.chat_attendance_approval_jobs enable row level security;
alter table public.chat_attendance_approval_events enable row level security;

create policy "Attendance job owner or managers read"
on public.chat_attendance_approval_jobs for select to authenticated
using (
  company_id = public.current_company_id()
  and (requester_profile_id = auth.uid() or public.is_company_manager(company_id))
);

create policy "Attendance job owner or managers read events"
on public.chat_attendance_approval_events for select to authenticated
using (
  company_id = public.current_company_id()
  and exists (
    select 1 from public.chat_attendance_approval_jobs job
    where job.id = job_id and job.company_id = company_id
      and (job.requester_profile_id = auth.uid() or public.is_company_manager(company_id))
  )
);

revoke insert, update, delete on public.chat_attendance_approval_jobs from anon, authenticated;
revoke insert, update, delete on public.chat_attendance_approval_events from anon, authenticated;
grant select on public.chat_attendance_approval_jobs, public.chat_attendance_approval_events to authenticated;

create or replace function public.create_web_chat_attendance_job(
  target_room_id uuid,
  target_request_code text,
  target_action text,
  target_site_id uuid,
  target_requested_at timestamptz,
  target_latitude numeric,
  target_longitude numeric,
  target_accuracy_meters numeric,
  target_selfie_path text,
  target_device_info jsonb default '{}'::jsonb
) returns public.chat_attendance_approval_jobs
language plpgsql security definer set search_path=public as $$
declare
  actor_id uuid := auth.uid();
  company_id_value uuid := public.current_company_id();
  existing_job public.chat_attendance_approval_jobs;
  created_job public.chat_attendance_approval_jobs;
  missing_fields text[] := '{}';
  employee_name text;
  resolved_site_id uuid := target_site_id;
begin
  if actor_id is null or company_id_value is null then raise exception 'authentication_required'; end if;
  if target_action not in ('clock_in','clock_out') then raise exception 'invalid_attendance_action'; end if;
  if nullif(trim(target_request_code),'') is null then raise exception 'request_code_required'; end if;

  select * into existing_job from public.chat_attendance_approval_jobs
  where company_id=company_id_value and request_code=trim(target_request_code);
  if found then return existing_job; end if;

  if not exists(select 1 from public.chat_rooms r where r.id=target_room_id and r.company_id=company_id_value) then
    raise exception 'chat_room_company_mismatch';
  end if;
  if not exists(select 1 from public.chat_room_members m where m.room_id=target_room_id and m.profile_id=actor_id)
     and not public.is_company_manager(company_id_value) then raise exception 'chat_room_membership_required'; end if;

  select nullif(trim(coalesce(p.full_name,'')),'') into employee_name from public.profiles p where p.id=actor_id;
  if employee_name is null then missing_fields := array_append(missing_fields,'employee_name'); end if;
  if target_requested_at is null then missing_fields := array_append(missing_fields,'requested_at'); end if;
  if target_action='clock_in' and target_site_id is null then missing_fields := array_append(missing_fields,'site_id'); end if;
  if target_action='clock_out' and resolved_site_id is null then
    select session.site_id into resolved_site_id from public.attendance_sessions session
    where session.company_id=company_id_value and session.profile_id=actor_id
      and session.clock_out_at is null and session.status not in ('rejected','duplicate')
    order by session.clock_in_at desc limit 1;
    if resolved_site_id is null then missing_fields := array_append(missing_fields,'open_attendance_session'); end if;
  end if;
  if target_latitude is null or target_longitude is null then missing_fields := array_append(missing_fields,'location'); end if;
  if nullif(trim(coalesce(target_selfie_path,'')),'') is null then missing_fields := array_append(missing_fields,'selfie'); end if;
  if resolved_site_id is not null and not exists(
    select 1 from public.project_sites s where s.id=resolved_site_id and s.company_id=company_id_value and s.active=true
  ) then missing_fields := array_append(missing_fields,'valid_site'); end if;

  insert into public.chat_attendance_approval_jobs(
    company_id,room_id,request_code,requester_profile_id,site_id,action,requested_at,
    latitude,longitude,accuracy_meters,selfie_path,device_info,status,validation_result
  ) values (
    company_id_value,target_room_id,trim(target_request_code),actor_id,resolved_site_id,target_action,
    coalesce(target_requested_at,now()),target_latitude,target_longitude,target_accuracy_meters,
    target_selfie_path,coalesce(target_device_info,'{}'::jsonb),
    case when cardinality(missing_fields)>0 then 'needs_more_info' else 'pending_approval' end,
    jsonb_build_object('employee_name',employee_name,'missing_fields',missing_fields,'duplicate_checked',true)
  ) returning * into created_job;

  insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
  values
    (company_id_value,created_job.id,actor_id,'data_detected',null,'detected','{}'),
    (company_id_value,created_job.id,actor_id,'precheck_completed','detected','prechecked',created_job.validation_result),
    (company_id_value,created_job.id,actor_id,
      case when created_job.status='pending_approval' then 'approval_requested' else 'more_information_required' end,
      'prechecked',created_job.status,created_job.validation_result);
  return created_job;
end $$;

create or replace function public.review_web_chat_attendance_job(
  target_job_id uuid,
  review_action text,
  review_note text default null
) returns public.chat_attendance_approval_jobs
language plpgsql security definer set search_path=public as $$
declare
  actor_id uuid := auth.uid();
  job public.chat_attendance_approval_jobs;
  session_id uuid;
  open_session public.attendance_sessions;
  duplicate_session uuid;
begin
  select * into job from public.chat_attendance_approval_jobs where id=target_job_id for update;
  if not found then raise exception 'attendance_job_not_found'; end if;
  if actor_id is null or not public.is_company_manager(job.company_id) then raise exception 'attendance_approver_required'; end if;
  if review_action not in ('approve','reject','request_more') then raise exception 'invalid_review_action'; end if;
  if job.status in ('recorded','closed') then return job; end if;
  if job.status <> 'pending_approval' then raise exception 'attendance_job_not_pending'; end if;

  if review_action in ('reject','request_more') then
    update public.chat_attendance_approval_jobs set
      status=case when review_action='reject' then 'rejected' else 'needs_more_info' end,
      responsible_profile_id=job.requester_profile_id, decision_note=nullif(trim(coalesce(review_note,'')),''), updated_at=now()
    where id=job.id returning * into job;
    insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
    values(job.company_id,job.id,actor_id,
      case when review_action='reject' then 'rejected' else 'more_information_required' end,
      'pending_approval',job.status,jsonb_build_object('note',review_note,'returned_to',job.requester_profile_id));
    return job;
  end if;

  if coalesce(jsonb_array_length(job.validation_result->'missing_fields'),0)>0 then raise exception 'attendance_job_incomplete'; end if;
  if not exists(select 1 from public.profiles p where p.id=job.requester_profile_id and nullif(trim(coalesce(p.full_name,'')),'') is not null)
    then raise exception 'employee_name_mismatch'; end if;
  if job.site_id is null and job.action='clock_in' then raise exception 'attendance_site_required'; end if;
  if job.site_id is not null and not exists(select 1 from public.project_sites s where s.id=job.site_id and s.company_id=job.company_id and s.active=true)
    then raise exception 'attendance_site_mismatch'; end if;

  if job.action='clock_in' then
    select s.id into duplicate_session from public.attendance_sessions s
    where s.company_id=job.company_id and s.profile_id=job.requester_profile_id
      and (s.clock_in_at at time zone 'Asia/Bangkok')::date=(job.requested_at at time zone 'Asia/Bangkok')::date
      and s.status not in ('rejected','duplicate') limit 1;
  else
    select * into open_session from public.attendance_sessions s
    where s.company_id=job.company_id and s.profile_id=job.requester_profile_id
      and s.clock_out_at is null and s.status not in ('rejected','duplicate')
    order by s.clock_in_at desc limit 1 for update;
    if not found then
      select s.id into duplicate_session from public.attendance_sessions s
      where s.company_id=job.company_id and s.profile_id=job.requester_profile_id
        and s.clock_out_at is not null
        and (s.clock_out_at at time zone 'Asia/Bangkok')::date=(job.requested_at at time zone 'Asia/Bangkok')::date
        and s.status not in ('rejected','duplicate') limit 1;
    end if;
  end if;

  if duplicate_session is not null then
    update public.chat_attendance_approval_jobs set status='needs_more_info',duplicate_of_job_id=(
      select prior.id from public.chat_attendance_approval_jobs prior
      where prior.attendance_session_id=duplicate_session and prior.company_id=job.company_id limit 1
    ),validation_result=validation_result||jsonb_build_object('duplicate_checked',true,'duplicate_attendance_session_id',duplicate_session),
      responsible_profile_id=job.requester_profile_id,decision_note='พบรายการลงเวลาจริงซ้ำ',updated_at=now()
    where id=job.id returning * into job;
    insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
    values(job.company_id,job.id,actor_id,'duplicate_detected','pending_approval','needs_more_info',jsonb_build_object('attendance_session_id',duplicate_session));
    return job;
  end if;

  update public.chat_attendance_approval_jobs set status='approved',responsible_profile_id=actor_id,approved_by=actor_id,approved_at=now(),decision_note=nullif(trim(coalesce(review_note,'')),''),updated_at=now()
  where id=job.id returning * into job;
  insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
  values(job.company_id,job.id,actor_id,'approval_granted','pending_approval','approved',jsonb_build_object('note',review_note));

  if job.action='clock_in' then
    insert into public.attendance_sessions(
      company_id,profile_id,site_id,clock_in_at,clock_in_latitude,clock_in_longitude,
      clock_in_accuracy_meters,clock_in_selfie_path,status,review_channel
    ) values(job.company_id,job.requester_profile_id,job.site_id,job.requested_at,job.latitude,job.longitude,
      job.accuracy_meters,job.selfie_path,'normal','web_chat_approval') returning id into session_id;
  else
    update public.attendance_sessions set clock_out_at=job.requested_at,clock_out_latitude=job.latitude,
      clock_out_longitude=job.longitude,clock_out_accuracy_meters=job.accuracy_meters,
      clock_out_selfie_path=job.selfie_path,updated_at=now()
    where id=open_session.id and clock_out_at is null returning id into session_id;
  end if;
  if session_id is null then raise exception 'attendance_record_not_written'; end if;

  update public.chat_attendance_approval_jobs set status='recorded',attendance_session_id=session_id,recorded_at=now(),updated_at=now()
  where id=job.id returning * into job;
  insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
  values(job.company_id,job.id,actor_id,'attendance_recorded','approved','recorded',jsonb_build_object('attendance_session_id',session_id));
  return job;
end $$;

create or replace function public.close_web_chat_attendance_job(target_job_id uuid)
returns public.chat_attendance_approval_jobs
language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); job public.chat_attendance_approval_jobs; required_count integer;
begin
  select * into job from public.chat_attendance_approval_jobs where id=target_job_id for update;
  if not found then raise exception 'attendance_job_not_found'; end if;
  if actor_id is null or not public.is_company_manager(job.company_id) then raise exception 'attendance_approver_required'; end if;
  if job.status='closed' then return job; end if;
  select count(distinct event_type) into required_count from public.chat_attendance_approval_events
  where job_id=job.id and event_type in ('data_detected','precheck_completed','approval_requested','approval_granted','attendance_recorded');
  if job.status<>'recorded' or job.attendance_session_id is null or job.duplicate_of_job_id is not null
     or coalesce(jsonb_array_length(job.validation_result->'missing_fields'),0)>0 or required_count<>5 then
    raise exception 'attendance_job_close_gate_failed';
  end if;
  update public.chat_attendance_approval_jobs set status='closed',closed_by=actor_id,closed_at=now(),updated_at=now()
  where id=job.id returning * into job;
  insert into public.chat_attendance_approval_events(company_id,job_id,actor_profile_id,event_type,from_status,to_status,details)
  values(job.company_id,job.id,actor_id,'job_closed_100_percent','recorded','closed',jsonb_build_object('audit_event_count',required_count));
  return job;
end $$;

revoke all on function public.create_web_chat_attendance_job(uuid,text,text,uuid,timestamptz,numeric,numeric,numeric,text,jsonb) from public,anon;
revoke all on function public.review_web_chat_attendance_job(uuid,text,text) from public,anon;
revoke all on function public.close_web_chat_attendance_job(uuid) from public,anon;
grant execute on function public.create_web_chat_attendance_job(uuid,text,text,uuid,timestamptz,numeric,numeric,numeric,text,jsonb) to authenticated;
grant execute on function public.review_web_chat_attendance_job(uuid,text,text) to authenticated;
grant execute on function public.close_web_chat_attendance_job(uuid) to authenticated;

comment on table public.chat_attendance_approval_jobs is 'Explicit Web Chat attendance approval jobs; closed means 100% gate passed.';

-- Approval MSG delivery/acknowledgement metadata. The job table remains the
-- source of truth; chat_messages is only the notification projection.
alter table public.chat_messages
  add column if not exists message_class text not null default 'user_message'
  check (message_class in ('user_message','system_confirmation'));
alter table public.chat_attendance_approval_jobs
  add column if not exists message_status text not null default 'pending_send'
    check (message_status in ('pending_send','sent','send_failed')),
  add column if not exists message_id uuid references public.chat_messages(id) on delete set null,
  add column if not exists recipient_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists message_sent_at timestamptz,
  add column if not exists claimed_by uuid references public.profiles(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists message_error text;
create index if not exists chat_attendance_approval_message_queue_idx
  on public.chat_attendance_approval_jobs(company_id,message_status,created_at desc);

create or replace function public.publish_attendance_approval_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; msg_id uuid; employee_name text; project_name text; site_name text; msg text;
begin
  select m.profile_id into recipient
  from public.company_members m
  join public.chat_room_members rm on rm.profile_id=m.profile_id and rm.room_id=new.room_id
  where m.company_id=new.company_id and m.active and m.company_role in ('company_admin','executive','manager','accounting_hr')
    and (m.ends_on is null or m.ends_on>=current_date)
  order by case m.company_role when 'company_admin' then 1 when 'executive' then 2 when 'manager' then 3 else 4 end limit 1;
  if recipient is null then
    update public.chat_attendance_approval_jobs set message_status='pending_send',recipient_profile_id=null,updated_at=now() where id=new.id;
    return new;
  end if;
  select coalesce(nullif(trim(p.full_name),''),p.email,p.id::text),coalesce(pr.name,'-'),coalesce(s.name,'-') into employee_name,project_name,site_name
  from public.profiles p left join public.project_sites s on s.id=new.site_id left join public.projects pr on pr.id=s.project_id where p.id=new.requester_profile_id;
  msg := '🕐 MSG ขออนุมัติรายการลงเวลา' || E'\nช่าง: '||coalesce(employee_name,'-') || E'\nเข้า/ออก: '||case when new.action='clock_in' then 'เข้า' else 'ออก' end || E'\nวันเวลา: '||to_char(new.requested_at at time zone 'Asia/Bangkok','DD/MM/YYYY HH24:MI') || E'\nโครงการ/ไซต์: '||project_name||' / '||site_name || E'\nรหัสรายการ: '||new.request_code || E'\nผลตรวจเบื้องต้น: '||coalesce(new.validation_result->>'duplicate_checked','ไม่ทราบ') || E'\nสถานะ: รออนุมัติ' || E'\nAction: อนุมัติ · Reject · ขอข้อมูลเพิ่ม';
  begin
    insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
    values(new.company_id,new.room_id,null,'text',msg,'system_confirmation') returning id into msg_id;
    update public.chat_attendance_approval_jobs set message_status='sent',message_id=msg_id,recipient_profile_id=recipient,message_sent_at=now(),message_error=null,updated_at=now() where id=new.id;
  exception when others then
    update public.chat_attendance_approval_jobs set message_status='send_failed',recipient_profile_id=recipient,message_error=left(sqlerrm,1000),updated_at=now() where id=new.id;
  end;
  return new;
end $$;
drop trigger if exists publish_attendance_approval_message_trigger on public.chat_attendance_approval_jobs;
create trigger publish_attendance_approval_message_trigger
after insert on public.chat_attendance_approval_jobs for each row execute function public.publish_attendance_approval_message();

create or replace function public.claim_attendance_approval_on_decision()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected','needs_more_info','closed') and new.claimed_by is null and auth.uid() is not null then
    new.claimed_by := auth.uid(); new.claimed_at := coalesce(new.claimed_at,now());
  end if;
  return new;
end $$;
drop trigger if exists claim_attendance_approval_on_decision_trigger on public.chat_attendance_approval_jobs;
create trigger claim_attendance_approval_on_decision_trigger before update on public.chat_attendance_approval_jobs for each row execute function public.claim_attendance_approval_on_decision();

-- Do not feed a system confirmation back into Omni Intake.
create or replace function public.omni_register_chat_message_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_row record; sender_row record;
begin
  if new.deleted_at is not null or new.message_class='system_confirmation' then return new; end if;
  select r.name into room_row from public.chat_rooms r where r.id=new.room_id and r.company_id=new.company_id limit 1;
  if new.sender_profile_id is not null then
    select coalesce(nullif(trim(p.full_name),''),p.email,p.id::text) as display_name into sender_row from public.profiles p where p.id=new.sender_profile_id limit 1;
  end if;
  perform public.omni_register_source(new.company_id,'web_chat',case when new.attachment_path is not null then 'file' else 'message' end,null,new.id,new.room_id::text,room_row.name,new.sender_profile_id::text,coalesce(sender_row.display_name,'ไม่ระบุผู้ส่ง'),new.created_at,coalesce(new.text_content,new.attachment_name,''),case when new.attachment_path is not null then 1 else 0 end,case when new.attachment_path is not null then md5(new.attachment_bucket||':'||new.attachment_path||':'||coalesce(new.attachment_size::text,'-')) else null end);
  return new;
exception when others then raise warning 'omni chat source sync failed for %: %',new.id,sqlerrm; return new;
end $$;
notify pgrst, 'reload schema';
