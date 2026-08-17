create or replace function public.soft_delete_attendance_session(target_session_id uuid, delete_reason text)
returns public.attendance_sessions language plpgsql security definer set search_path=public as $$
declare actor public.profiles; before_row public.attendance_sessions; after_row public.attendance_sessions; work_date date;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.role <> 'admin' then raise exception 'platform_admin_required'; end if;
  if char_length(trim(coalesce(delete_reason,''))) < 3 then raise exception 'reason_required'; end if;
  select * into before_row from public.attendance_sessions where id=target_session_id and company_id=public.current_company_id() for update;
  if before_row.id is null then raise exception 'session_not_found_in_active_company'; end if;
  if before_row.status in ('rejected','duplicate') then raise exception 'session_already_inactive'; end if;
  work_date := (before_row.clock_in_at at time zone 'Asia/Bangkok')::date;
  if exists(select 1 from public.employee_payrolls payroll join public.pay_periods period on period.id=payroll.pay_period_id where payroll.company_id=before_row.company_id and payroll.profile_id=before_row.profile_id and work_date between period.starts_on and period.ends_on and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))) then raise exception 'payroll_period_closed'; end if;
  update public.attendance_sessions set status='rejected',calculation_status='excluded',review_reason=trim(delete_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=before_row.id returning * into after_row;
  insert into public.attendance_audit_logs(company_id,session_id,actor_profile_id,action,reason,old_values,new_values) values(before_row.company_id,before_row.id,auth.uid(),'platform_admin_soft_delete',trim(delete_reason),to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end; $$;

create or replace function public.restore_soft_deleted_attendance_session(target_session_id uuid, restore_reason text)
returns public.attendance_sessions language plpgsql security definer set search_path=public as $$
declare actor public.profiles; before_row public.attendance_sessions; after_row public.attendance_sessions; business_date date;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.role <> 'admin' then raise exception 'platform_admin_required'; end if;
  if char_length(trim(coalesce(restore_reason,''))) < 3 then raise exception 'reason_required'; end if;
  select * into before_row from public.attendance_sessions where id=target_session_id and company_id=public.current_company_id() for update;
  if before_row.id is null or before_row.status <> 'rejected' then raise exception 'soft_deleted_session_not_found'; end if;
  business_date := (before_row.clock_in_at at time zone 'Asia/Bangkok')::date;
  if exists(select 1 from public.attendance_sessions existing where existing.company_id=before_row.company_id and existing.profile_id=before_row.profile_id and existing.id<>before_row.id and existing.status not in ('rejected','duplicate') and (existing.clock_in_at at time zone 'Asia/Bangkok')::date=business_date) then raise exception 'active_session_exists_for_date'; end if;
  update public.attendance_sessions set status='needs_review',calculation_status='pending',review_reason=trim(restore_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=before_row.id returning * into after_row;
  insert into public.attendance_audit_logs(company_id,session_id,actor_profile_id,action,reason,old_values,new_values) values(before_row.company_id,before_row.id,auth.uid(),'platform_admin_restore',trim(restore_reason),to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end; $$;

revoke all on function public.soft_delete_attendance_session(uuid,text) from public;
revoke all on function public.restore_soft_deleted_attendance_session(uuid,text) from public;
grant execute on function public.soft_delete_attendance_session(uuid,text) to authenticated;
grant execute on function public.restore_soft_deleted_attendance_session(uuid,text) to authenticated;
