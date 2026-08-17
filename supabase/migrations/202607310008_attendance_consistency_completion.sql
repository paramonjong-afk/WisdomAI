create table if not exists public.attendance_system_settings (
  singleton boolean primary key default true check (singleton),
  max_gps_accuracy_meters integer not null default 200 check (max_gps_accuracy_meters between 20 and 1000),
  allow_outside_site_for_review boolean not null default true,
  shared_devices_allowed boolean not null default true,
  stale_session_mode text not null default 'require_clock_out'
    check (stale_session_mode in ('require_clock_out','manager_review')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.attendance_system_settings(singleton) values (true)
on conflict (singleton) do nothing;
alter table public.attendance_system_settings enable row level security;
create policy "Authenticated users read attendance settings"
on public.attendance_system_settings for select to authenticated using (true);
create policy "Managers update attendance settings"
on public.attendance_system_settings for update to authenticated
using (public.is_work_manager()) with check (public.is_work_manager());

create table if not exists public.attendance_notifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('clock_in','clock_out')),
  channel text not null default 'line' check (channel in ('line')),
  status text not null default 'queued' check (status in ('queued','sent','skipped','failed')),
  reason text,
  attempts integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,event_type,channel)
);
alter table public.attendance_notifications enable row level security;
create policy "Attendance notifications visible to owner or manager"
on public.attendance_notifications for select to authenticated using (
  public.is_work_manager() or exists (
    select 1 from public.attendance_sessions session
    where session.id=session_id and session.profile_id=auth.uid()
  )
);

with ranked as (
  select id, row_number() over (
    partition by session_id order by created_at desc, id
  ) as row_rank
  from public.attendance_correction_requests
  where status='pending'
)
update public.attendance_correction_requests request set
  status='cancelled',
  review_note='ยกเลิกคำขอซ้ำอัตโนมัติ โดยเก็บคำขอล่าสุดไว้',
  updated_at=now()
from ranked
where request.id=ranked.id and ranked.row_rank>1;

create unique index if not exists one_pending_attendance_correction_per_session
  on public.attendance_correction_requests(session_id)
  where status='pending';

create or replace function public.request_attendance_correction(
  target_session_id uuid,
  requested_in timestamptz,
  requested_out timestamptz,
  request_reason text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare request_id uuid;
begin
  if not exists (
    select 1 from public.attendance_sessions
    where id=target_session_id and profile_id=auth.uid() and status <> 'duplicate'
  ) then raise exception 'ไม่พบรายการลงเวลาที่แก้ไขได้'; end if;
  if char_length(trim(request_reason)) < 3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if requested_out is not null and requested_in is not null and requested_out < requested_in then
    raise exception 'เวลาออกต้องไม่ก่อนเวลาเข้า';
  end if;
  if exists (
    select 1 from public.attendance_correction_requests
    where session_id=target_session_id and status='pending'
  ) then raise exception 'รายการนี้มีคำขอแก้ไขที่กำลังรอตรวจอยู่แล้ว'; end if;

  insert into public.attendance_correction_requests(
    session_id, profile_id, requested_clock_in_at, requested_clock_out_at, reason
  ) values (
    target_session_id, auth.uid(), requested_in, requested_out, trim(request_reason)
  ) returning id into request_id;
  update public.attendance_sessions set status='needs_review',updated_at=now()
  where id=target_session_id;
  return request_id;
end;
$$;

create or replace function public.review_attendance_correction(
  target_request_id uuid,
  decision text,
  decision_note text default null
) returns public.attendance_correction_requests
language plpgsql security definer set search_path=public
as $$
declare request_row public.attendance_correction_requests;
declare before_row public.attendance_sessions;
declare after_request public.attendance_correction_requests;
begin
  if not public.is_work_manager() then raise exception 'ไม่มีสิทธิ์ตรวจคำขอแก้ไขเวลา'; end if;
  if decision not in ('approved','rejected') then raise exception 'ผลการตรวจไม่ถูกต้อง'; end if;
  if decision='rejected' and nullif(trim(decision_note),'') is null then
    raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;
  select * into request_row from public.attendance_correction_requests
  where id=target_request_id for update;
  if request_row.id is null or request_row.status <> 'pending' then
    raise exception 'คำขอนี้ไม่ได้อยู่ในสถานะรอตรวจ';
  end if;
  select * into before_row from public.attendance_sessions
  where id=request_row.session_id for update;

  if decision='approved' then
    if request_row.requested_clock_out_at is not null
      and request_row.requested_clock_in_at is not null
      and request_row.requested_clock_out_at < request_row.requested_clock_in_at then
      raise exception 'เวลาออกต้องไม่ก่อนเวลาเข้า';
    end if;
    update public.attendance_sessions set
      clock_in_at=coalesce(request_row.requested_clock_in_at,clock_in_at),
      clock_out_at=coalesce(request_row.requested_clock_out_at,clock_out_at),
      status='approved',review_reason=nullif(trim(decision_note),''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=request_row.session_id;
  else
    update public.attendance_sessions set
      status=case when clock_out_at is null then 'needs_review' else 'normal' end,
      review_reason=nullif(trim(decision_note),''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=request_row.session_id;
  end if;

  update public.attendance_correction_requests set
    status=decision,reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=nullif(trim(decision_note),''),updated_at=now()
  where id=target_request_id returning * into after_request;

  insert into public.attendance_audit_logs(
    session_id,actor_profile_id,action,reason,old_values,new_values
  ) select request_row.session_id,auth.uid(),'correction_'||decision,decision_note,
    to_jsonb(before_row),to_jsonb(session)
  from public.attendance_sessions session where session.id=request_row.session_id;
  return after_request;
end;
$$;
grant execute on function public.review_attendance_correction(uuid,text,text) to authenticated;

create or replace function public.review_attendance_session(
  target_session_id uuid,
  review_action text,
  corrected_clock_out_at timestamptz default null,
  review_note text default null
) returns public.attendance_sessions
language plpgsql security definer set search_path=public
as $$
declare before_row public.attendance_sessions;
declare after_row public.attendance_sessions;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into before_row from public.attendance_sessions where id=target_session_id for update;
  if not found then raise exception 'Attendance session not found'; end if;
  if before_row.status='duplicate' then raise exception 'ไม่สามารถอนุมัติรายการซ้ำได้'; end if;
  if review_action not in ('approve','reject','correct') then raise exception 'Invalid action'; end if;
  if review_action='approve' and before_row.clock_out_at is null then
    raise exception 'รายการยังไม่มีเวลาออก กรุณาเพิ่มเวลาออกก่อนอนุมัติ';
  end if;
  if review_action='correct' and corrected_clock_out_at is null then
    raise exception 'กรุณาระบุเวลาออกที่ถูกต้อง';
  end if;
  if review_action='correct' and corrected_clock_out_at < before_row.clock_in_at then
    raise exception 'เวลาออกต้องไม่ก่อนเวลาเข้า';
  end if;
  if review_action in ('reject','correct') and nullif(trim(review_note),'') is null then
    raise exception 'Review reason is required';
  end if;

  update public.attendance_sessions set
    clock_out_at=case when review_action='correct' then corrected_clock_out_at else clock_out_at end,
    status=case when review_action='reject' then 'rejected' else 'approved' end,
    review_reason=nullif(trim(review_note),''),
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=target_session_id returning * into after_row;
  insert into public.attendance_audit_logs(
    session_id,actor_profile_id,action,reason,old_values,new_values
  ) values(target_session_id,auth.uid(),review_action,review_note,to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end;
$$;

create or replace function public.recalculate_attendance_session(target_session_id uuid)
returns public.attendance_sessions
language plpgsql security definer set search_path=public
as $$
declare
  session_row public.attendance_sessions;
  policy_row public.work_policies;
  business_date date;
  scheduled_start timestamptz; scheduled_end timestamptz;
  break_start timestamptz; break_end timestamptz;
  break_used integer:=0; worked integer:=0; normal_work integer:=0;
  approved_ot integer:=0; late integer:=0; early integer:=0;
  is_work_day boolean:=true;
begin
  select * into session_row from public.attendance_sessions where id=target_session_id;
  if not found then raise exception 'Attendance session not found'; end if;
  select * into policy_row from public.work_policies where id=coalesce(
    (select work_policy_id from public.project_sites where id=session_row.site_id),
    (select work_policy_id from public.employee_employment_records where profile_id=session_row.profile_id),
    (select id from public.work_policies where active order by created_at limit 1)
  );
  if policy_row.id is null then raise exception 'Work policy not found'; end if;
  business_date:=(session_row.clock_in_at at time zone policy_row.timezone)::date;
  scheduled_start:=(business_date+policy_row.work_start_time) at time zone policy_row.timezone;
  scheduled_end:=(business_date+policy_row.work_end_time) at time zone policy_row.timezone;
  break_start:=(business_date+policy_row.break_start_time) at time zone policy_row.timezone;
  break_end:=(business_date+policy_row.break_end_time) at time zone policy_row.timezone;
  is_work_day:=extract(isodow from business_date)::integer=any(policy_row.work_weekdays)
    and not exists(select 1 from public.company_holidays holiday
      where holiday.holiday_date=business_date
        and (holiday.site_id is null or holiday.site_id=session_row.site_id));

  if session_row.status in ('rejected','duplicate') then
    update public.attendance_sessions set calculation_status='excluded',
      worked_minutes=null,normal_minutes=null,overtime_minutes=0,updated_at=now()
    where id=target_session_id returning * into session_row;
    return session_row;
  end if;
  if session_row.clock_out_at is null then
    update public.attendance_sessions set scheduled_start_at=scheduled_start,scheduled_end_at=scheduled_end,
      calculation_status='needs_review',worked_minutes=null,normal_minutes=null,overtime_minutes=0,updated_at=now()
    where id=target_session_id returning * into session_row;
    return session_row;
  end if;

  worked:=greatest(0,floor(extract(epoch from(session_row.clock_out_at-session_row.clock_in_at))/60)::integer);
  if least(session_row.clock_out_at,break_end)>greatest(session_row.clock_in_at,break_start) then
    break_used:=floor(extract(epoch from(
      least(session_row.clock_out_at,break_end)-greatest(session_row.clock_in_at,break_start)
    ))/60)::integer;
  end if;
  worked:=greatest(0,worked-break_used);

  if is_work_day and least(session_row.clock_out_at,scheduled_end)>greatest(session_row.clock_in_at,scheduled_start) then
    normal_work:=floor(extract(epoch from(
      least(session_row.clock_out_at,scheduled_end)-greatest(session_row.clock_in_at,scheduled_start)
    ))/60)::integer;
    normal_work:=greatest(0,normal_work-break_used);
    normal_work:=least(policy_row.standard_minutes,normal_work);
    late:=greatest(0,floor(extract(epoch from(
      session_row.clock_in_at-(scheduled_start+make_interval(mins=>policy_row.grace_minutes))
    ))/60)::integer);
    early:=greatest(0,floor(extract(epoch from(scheduled_end-session_row.clock_out_at))/60)::integer);
  end if;

  select coalesce(sum(least(
    coalesce(assignment.approved_minutes,2147483647),
    floor((
      case when not is_work_day then
        greatest(0,extract(epoch from(
          least(session_row.clock_out_at,assignment.ends_at)
          - greatest(session_row.clock_in_at,assignment.starts_at)
        )))
      else
        greatest(0,extract(epoch from(
          least(session_row.clock_out_at,assignment.ends_at,scheduled_start)
          - greatest(session_row.clock_in_at,assignment.starts_at)
        )))
        + greatest(0,extract(epoch from(
          least(session_row.clock_out_at,assignment.ends_at)
          - greatest(session_row.clock_in_at,assignment.starts_at,scheduled_end)
        )))
      end
    )/60/policy_row.overtime_round_minutes)::integer*policy_row.overtime_round_minutes
  )),0)::integer into approved_ot
  from public.employee_overtime_assignments assignment
  where assignment.profile_id=session_row.profile_id and assignment.status='approved'
    and assignment.starts_at<session_row.clock_out_at and assignment.ends_at>session_row.clock_in_at
    ;
  approved_ot:=least(approved_ot,greatest(0,worked-normal_work));

  update public.attendance_sessions set
    scheduled_start_at=scheduled_start,scheduled_end_at=scheduled_end,
    break_minutes=break_used,worked_minutes=worked,normal_minutes=normal_work,
    overtime_minutes=approved_ot,late_minutes=late,early_leave_minutes=early,
    calculation_status=case when status in ('needs_review','pending') then 'needs_review' else 'calculated' end,
    updated_at=now()
  where id=target_session_id returning * into session_row;
  return session_row;
end;
$$;

grant select on public.attendance_system_settings to authenticated;

do $$
declare target record;
begin
  for target in
    select id from public.attendance_sessions
    where status <> 'duplicate'
    order by clock_in_at
  loop
    perform public.recalculate_attendance_session(target.id);
  end loop;
end;
$$;
