-- Close consistency gaps found during the end-to-end attendance/workforce review.

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
declare proposed_in timestamptz;
declare proposed_out timestamptz;
declare proposed_date date;
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
    proposed_in:=coalesce(request_row.requested_clock_in_at,before_row.clock_in_at);
    proposed_out:=coalesce(request_row.requested_clock_out_at,before_row.clock_out_at);
    if proposed_out is not null and proposed_out < proposed_in then
      raise exception 'เวลาออกต้องไม่ก่อนเวลาเข้า';
    end if;
    proposed_date:=(proposed_in at time zone 'Asia/Bangkok')::date;
    perform pg_advisory_xact_lock(hashtextextended(before_row.profile_id::text||proposed_date::text,0));
    if exists(
      select 1 from public.attendance_sessions existing
      where existing.profile_id=before_row.profile_id
        and existing.id<>before_row.id
        and existing.status not in ('rejected','duplicate')
        and (existing.clock_in_at at time zone 'Asia/Bangkok')::date=proposed_date
    ) then
      raise exception 'วันที่แก้ไขมีรายการลงเวลาอยู่แล้ว';
    end if;
    update public.attendance_sessions set
      clock_in_at=proposed_in,clock_out_at=proposed_out,
      status='approved',review_reason=nullif(trim(decision_note),''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    where id=request_row.session_id;
  else
    update public.attendance_sessions session set
      status=case
        when session.clock_out_at is null then 'needs_review'
        when coalesce(session.clock_in_distance_meters,0)>coalesce(site.radius_meters,2147483647)
          or coalesce(session.clock_out_distance_meters,0)>coalesce(site.radius_meters,2147483647)
          then 'needs_review'
        else 'normal'
      end,
      review_reason=nullif(trim(decision_note),''),
      reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
    from public.project_sites site
    where session.id=request_row.session_id and site.id=session.site_id;
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
  if exists(select 1 from public.attendance_correction_requests
    where session_id=target_session_id and status='pending') then
    raise exception 'รายการนี้มีคำขอแก้เวลารอตรวจ กรุณาดำเนินการจากคำขอแก้เวลา';
  end if;
  select * into before_row from public.attendance_sessions where id=target_session_id for update;
  if not found then raise exception 'Attendance session not found'; end if;
  if before_row.status='duplicate' then raise exception 'ไม่สามารถอนุมัติรายการซ้ำได้'; end if;
  if review_action not in ('approve','reject','correct') then raise exception 'Invalid action'; end if;
  if review_action='approve' and before_row.clock_out_at is null then
    raise exception 'รายการยังไม่มีเวลาออก กรุณาเพิ่มเวลาออกก่อนอนุมัติ';
  end if;
  if review_action='correct' and corrected_clock_out_at is null then raise exception 'กรุณาระบุเวลาออก'; end if;
  if review_action='correct' and corrected_clock_out_at < before_row.clock_in_at then raise exception 'เวลาออกต้องไม่ก่อนเวลาเข้า'; end if;
  if review_action in ('reject','correct') and nullif(trim(review_note),'') is null then raise exception 'Review reason is required'; end if;
  update public.attendance_sessions set
    clock_out_at=case when review_action='correct' then corrected_clock_out_at else clock_out_at end,
    status=case when review_action='reject' then 'rejected' else 'approved' end,
    review_reason=nullif(trim(review_note),''),
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  where id=target_session_id returning * into after_row;
  insert into public.attendance_audit_logs(session_id,actor_profile_id,action,reason,old_values,new_values)
  values(target_session_id,auth.uid(),review_action,review_note,to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end;
$$;

create or replace function public.validate_overtime_assignment_overlap()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status in ('assigned','acknowledged','pending_approval','approved')
    and exists(
      select 1 from public.employee_overtime_assignments existing
      where existing.profile_id=new.profile_id and existing.id<>new.id
        and existing.status in ('assigned','acknowledged','pending_approval','approved')
        and existing.starts_at<new.ends_at and existing.ends_at>new.starts_at
    ) then
    raise exception 'ช่วง OT ซ้อนกับรายการเดิมของพนักงาน';
  end if;
  return new;
end;
$$;
drop trigger if exists validate_overtime_assignment_overlap on public.employee_overtime_assignments;
create trigger validate_overtime_assignment_overlap
before insert or update of profile_id,starts_at,ends_at,status
on public.employee_overtime_assignments for each row
execute function public.validate_overtime_assignment_overlap();

create or replace function public.retry_failed_attendance_notifications(max_rows integer default 50)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  update public.attendance_notifications set status='queued',reason=null,updated_at=now()
  where id in (
    select id from public.attendance_notifications
    where status='failed' and attempts<5 order by updated_at limit greatest(1,least(max_rows,200))
    for update skip locked
  );
  get diagnostics changed=row_count;
  return changed;
end;
$$;
grant execute on function public.retry_failed_attendance_notifications(integer) to authenticated;

