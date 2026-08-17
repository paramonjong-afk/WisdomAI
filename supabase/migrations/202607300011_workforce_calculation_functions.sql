-- Deterministic attendance and payroll calculations.

create or replace function public.validate_leave_request()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.ends_at <= new.starts_at then raise exception 'Leave end must be after start'; end if;
  if exists (
    select 1 from public.employee_leave_requests existing
    where existing.profile_id=new.profile_id and existing.id<>new.id
      and existing.status in ('pending','late_notice','needs_evidence','approved','used')
      and existing.starts_at<new.ends_at and existing.ends_at>new.starts_at
  ) then raise exception 'Leave request overlaps an existing request'; end if;
  return new;
end;
$$;
drop trigger if exists validate_leave_request on public.employee_leave_requests;
create trigger validate_leave_request before insert or update of starts_at,ends_at,status
on public.employee_leave_requests for each row execute function public.validate_leave_request();

create or replace function public.recalculate_attendance_session(target_session_id uuid)
returns public.attendance_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.attendance_sessions;
  policy_row public.work_policies;
  business_date date;
  scheduled_start timestamptz;
  scheduled_end timestamptz;
  break_start timestamptz;
  break_end timestamptz;
  break_used integer := 0;
  worked integer := 0;
  normal_work integer := 0;
  approved_ot integer := 0;
  late integer := 0;
  early integer := 0;
begin
  select * into session_row from public.attendance_sessions where id=target_session_id;
  if not found then raise exception 'Attendance session not found'; end if;

  select policy.* into policy_row
  from public.work_policies policy
  left join public.project_sites site on site.work_policy_id=policy.id
  left join public.employee_employment_records employment on employment.work_policy_id=policy.id
  where policy.id=coalesce(
    (select work_policy_id from public.project_sites where id=session_row.site_id),
    (select work_policy_id from public.employee_employment_records where profile_id=session_row.profile_id),
    (select id from public.work_policies where active order by created_at limit 1)
  )
  limit 1;

  if policy_row.id is null then raise exception 'Work policy not found'; end if;
  business_date := (session_row.clock_in_at at time zone policy_row.timezone)::date;
  scheduled_start := (business_date + policy_row.work_start_time) at time zone policy_row.timezone;
  scheduled_end := (business_date + policy_row.work_end_time) at time zone policy_row.timezone;
  break_start := (business_date + policy_row.break_start_time) at time zone policy_row.timezone;
  break_end := (business_date + policy_row.break_end_time) at time zone policy_row.timezone;

  if session_row.clock_out_at is null then
    update public.attendance_sessions set
      scheduled_start_at=scheduled_start, scheduled_end_at=scheduled_end,
      calculation_status='needs_review', worked_minutes=null, normal_minutes=null,
      overtime_minutes=0, updated_at=now()
    where id=target_session_id returning * into session_row;
    return session_row;
  end if;

  worked := greatest(0, floor(extract(epoch from (session_row.clock_out_at-session_row.clock_in_at))/60)::integer);
  break_used := greatest(0, floor(extract(epoch from (
    least(session_row.clock_out_at,break_end)-greatest(session_row.clock_in_at,break_start)
  ))/60)::integer);
  if least(session_row.clock_out_at,break_end) <= greatest(session_row.clock_in_at,break_start) then
    break_used := 0;
  end if;
  worked := greatest(0, worked-break_used);

  if least(session_row.clock_out_at,scheduled_end) > greatest(session_row.clock_in_at,scheduled_start) then
    normal_work := floor(extract(epoch from (
      least(session_row.clock_out_at,scheduled_end)-greatest(session_row.clock_in_at,scheduled_start)
    ))/60)::integer;
    if least(session_row.clock_out_at,scheduled_end,break_end)
      > greatest(session_row.clock_in_at,scheduled_start,break_start) then
      normal_work := normal_work - floor(extract(epoch from (
        least(session_row.clock_out_at,scheduled_end,break_end)
        - greatest(session_row.clock_in_at,scheduled_start,break_start)
      ))/60)::integer;
    end if;
  end if;
  normal_work := least(policy_row.standard_minutes,greatest(0,normal_work));

  late := greatest(0,floor(extract(epoch from (
    session_row.clock_in_at-(scheduled_start+make_interval(mins=>policy_row.grace_minutes))
  ))/60)::integer);
  early := greatest(0,floor(extract(epoch from (scheduled_end-session_row.clock_out_at))/60)::integer);

  select coalesce(sum(
    floor(greatest(0,extract(epoch from (
      least(session_row.clock_out_at,assignment.ends_at)
      - greatest(session_row.clock_in_at,assignment.starts_at)
    ))/60)/policy_row.overtime_round_minutes)::integer * policy_row.overtime_round_minutes
  ),0)::integer into approved_ot
  from public.employee_overtime_assignments assignment
  where assignment.profile_id=session_row.profile_id
    and assignment.status='approved'
    and assignment.starts_at < session_row.clock_out_at
    and assignment.ends_at > session_row.clock_in_at;

  update public.attendance_sessions set
    scheduled_start_at=scheduled_start, scheduled_end_at=scheduled_end,
    break_minutes=break_used, worked_minutes=worked, normal_minutes=normal_work,
    overtime_minutes=approved_ot, late_minutes=late, early_leave_minutes=early,
    calculation_status=case when status in ('needs_review','pending','rejected') then 'needs_review' else 'calculated' end,
    updated_at=now()
  where id=target_session_id returning * into session_row;
  return session_row;
end;
$$;

create or replace function public.recalculate_attendance_after_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.recalculate_attendance_session(new.id);
  return new;
end;
$$;

drop trigger if exists calculate_attendance_after_clock_out on public.attendance_sessions;
create trigger calculate_attendance_after_clock_out
after insert or update of clock_out_at,status on public.attendance_sessions
for each row
execute function public.recalculate_attendance_after_change();

create or replace function public.review_leave_request(
  target_request_id uuid, decision text, decision_note text default null
) returns public.employee_leave_requests
language plpgsql security definer set search_path=public as $$
declare before_row public.employee_leave_requests;
declare after_row public.employee_leave_requests;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if decision not in ('approved','rejected','needs_evidence') then raise exception 'Invalid decision'; end if;
  if decision <> 'approved' and nullif(trim(decision_note),'') is null then raise exception 'Reason is required'; end if;
  select * into before_row from public.employee_leave_requests where id=target_request_id for update;
  if not found then raise exception 'Leave request not found'; end if;
  if before_row.status not in ('pending','late_notice','needs_evidence') then raise exception 'Request cannot be reviewed'; end if;
  if decision='approved' and exists (
    select 1 from public.leave_types leave_type
    where leave_type.id=before_row.leave_type_id
      and leave_type.evidence_required_after_minutes is not null
      and before_row.requested_minutes>=leave_type.evidence_required_after_minutes
      and before_row.evidence_path is null
  ) then raise exception 'Supporting evidence is required before approval'; end if;
  update public.employee_leave_requests set status=decision, reviewed_by=auth.uid(),
    reviewed_at=now(), review_note=nullif(trim(decision_note),''), updated_at=now()
  where id=target_request_id returning * into after_row;
  insert into public.employee_workforce_audit_logs(profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values)
  values(after_row.profile_id,auth.uid(),'leave_request',after_row.id,decision,decision_note,to_jsonb(before_row),to_jsonb(after_row));
  return after_row;
end;
$$;

create or replace function public.review_overtime_assignment(
  target_assignment_id uuid, decision text, decision_note text default null
) returns public.employee_overtime_assignments
language plpgsql security definer set search_path=public as $$
declare before_row public.employee_overtime_assignments;
declare after_row public.employee_overtime_assignments;
declare session_id uuid;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if decision not in ('approved','rejected','cancelled') then raise exception 'Invalid decision'; end if;
  select * into before_row from public.employee_overtime_assignments where id=target_assignment_id for update;
  if not found then raise exception 'OT assignment not found'; end if;
  if decision='approved' and exists (
    select 1 from public.employee_leave_requests leave_request
    where leave_request.profile_id=before_row.profile_id
      and leave_request.status in ('approved','used')
      and leave_request.starts_at<before_row.ends_at
      and leave_request.ends_at>before_row.starts_at
  ) then raise exception 'OT overlaps approved leave'; end if;
  update public.employee_overtime_assignments set status=decision,
    approved_by=case when decision='approved' then auth.uid() else approved_by end,
    approved_at=case when decision='approved' then now() else approved_at end,
    updated_at=now()
  where id=target_assignment_id returning * into after_row;
  insert into public.employee_workforce_audit_logs(profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values)
  values(after_row.profile_id,auth.uid(),'overtime_assignment',after_row.id,decision,decision_note,to_jsonb(before_row),to_jsonb(after_row));
  for session_id in select id from public.attendance_sessions
    where profile_id=after_row.profile_id and clock_in_at<after_row.ends_at
      and coalesce(clock_out_at,now())>after_row.starts_at
  loop perform public.recalculate_attendance_session(session_id); end loop;
  return after_row;
end;
$$;

create or replace function public.generate_pay_period(target_pay_period_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare period public.pay_periods;
declare employee public.employee_employment_records;
declare v_payroll_id uuid;
declare normal_total integer;
declare ot_total integer;
declare paid_leave_total integer;
declare base_amount numeric(14,2);
declare ot_amount numeric(14,2);
declare add_amount numeric(14,2);
declare deduct_amount numeric(14,2);
declare reimburse_amount numeric(14,2);
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into period from public.pay_periods where id=target_pay_period_id for update;
  if not found then raise exception 'Pay period not found'; end if;
  if period.status in ('closed','paying','paid','cancelled') then raise exception 'Pay period is locked'; end if;
  update public.pay_periods set status='calculating',updated_at=now() where id=period.id;

  for employee in select * from public.employee_employment_records
    where employment_status in ('probation','active','notice')
  loop
    select coalesce(sum(normal_minutes),0),coalesce(sum(overtime_minutes),0)
      into normal_total,ot_total
    from public.attendance_sessions
    where profile_id=employee.profile_id
      and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
      and status in ('normal','approved') and calculation_status='calculated';

    select coalesce(sum(round(request.requested_minutes*leave_type.paid_ratio)),0)::integer
      into paid_leave_total
    from public.employee_leave_requests request
    join public.leave_types leave_type on leave_type.id=request.leave_type_id
    where request.profile_id=employee.profile_id and request.status in ('approved','used')
      and (request.starts_at at time zone 'Asia/Bangkok')::date <= period.ends_on
      and (request.ends_at at time zone 'Asia/Bangkok')::date >= period.starts_on;

    base_amount := case when employee.employment_type='monthly'
      then employee.monthly_salary
      else round(((normal_total+paid_leave_total)::numeric/480)*employee.daily_rate,2) end;
    ot_amount := round((ot_total::numeric/60)*employee.overtime_hourly_rate,2);
    select
      coalesce(sum(amount) filter(where adjustment_type in ('allowance','bonus')),0),
      coalesce(sum(amount) filter(where adjustment_type in ('wage_advance','cash_advance','deduction')),0),
      coalesce(sum(amount) filter(where adjustment_type='reimbursement'),0)
    into add_amount,deduct_amount,reimburse_amount
    from public.employee_pay_adjustments
    where profile_id=employee.profile_id and effective_date between period.starts_on and period.ends_on
      and status in ('approved','paid');

    insert into public.employee_payrolls(
      pay_period_id,profile_id,normal_minutes,overtime_minutes,base_pay,overtime_pay,
      additions,deductions,reimbursements,net_pay,status
    ) values(
      period.id,employee.profile_id,normal_total,ot_total,base_amount,ot_amount,
      add_amount,deduct_amount,reimburse_amount,
      base_amount+ot_amount+add_amount+reimburse_amount-deduct_amount,'estimated'
    )
    on conflict(pay_period_id,profile_id) do update set
      normal_minutes=excluded.normal_minutes,overtime_minutes=excluded.overtime_minutes,
      base_pay=excluded.base_pay,overtime_pay=excluded.overtime_pay,
      additions=excluded.additions,deductions=excluded.deductions,
      reimbursements=excluded.reimbursements,net_pay=excluded.net_pay,
      status=case when public.employee_payrolls.status in ('closed','paid') then public.employee_payrolls.status else 'estimated' end,
      updated_at=now()
    returning id into v_payroll_id;

    delete from public.employee_payroll_lines where payroll_id=v_payroll_id;
    insert into public.employee_payroll_lines(payroll_id,line_type,description,quantity,rate,amount)
    values
      (v_payroll_id,'base_pay','ค่าจ้างปกติ',normal_total,case when employee.employment_type='monthly' then employee.monthly_salary else employee.daily_rate end,base_amount),
      (v_payroll_id,'paid_leave','วันลาที่ได้รับค่าจ้าง',paid_leave_total,case when employee.employment_type='monthly' then 0 else employee.daily_rate end,0),
      (v_payroll_id,'overtime','ค่า OT ที่อนุมัติ',ot_total,employee.overtime_hourly_rate,ot_amount);
  end loop;
  update public.pay_periods set status='review',updated_at=now() where id=period.id;
end;
$$;

create or replace function public.review_document_request(
  target_request_id uuid, decision text, decision_note text default null
) returns public.employee_document_requests
language plpgsql security definer set search_path=public as $$
declare request_row public.employee_document_requests;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if decision not in ('approved','rejected','needs_information') then raise exception 'Invalid decision'; end if;
  if decision <> 'approved' and nullif(trim(decision_note),'') is null then raise exception 'Reason is required'; end if;
  select * into request_row from public.employee_document_requests where id=target_request_id for update;
  if not found or request_row.status <> 'pending' then raise exception 'Document request cannot be reviewed'; end if;
  if decision='approved' and request_row.document_type='payslip' and not exists (
    select 1 from public.employee_payrolls payroll
    where payroll.profile_id=request_row.profile_id
      and (request_row.pay_period_id is null or payroll.pay_period_id=request_row.pay_period_id)
      and payroll.status='paid'
  ) then
    raise exception 'Payslip cannot be issued before payroll payment is confirmed';
  end if;
  update public.employee_document_requests set status=decision,reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=nullif(trim(decision_note),''),updated_at=now()
  where id=target_request_id and status='pending' returning * into request_row;
  if not found then raise exception 'Document request cannot be reviewed'; end if;
  insert into public.employee_workforce_audit_logs(profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values)
  values(request_row.profile_id,auth.uid(),'document_request',request_row.id,decision,decision_note,to_jsonb(request_row));
  return request_row;
end;
$$;

revoke all on function public.recalculate_attendance_session(uuid) from public;
revoke all on function public.review_leave_request(uuid,text,text) from public;
revoke all on function public.review_overtime_assignment(uuid,text,text) from public;
revoke all on function public.generate_pay_period(uuid) from public;
revoke all on function public.review_document_request(uuid,text,text) from public;
grant execute on function public.review_leave_request(uuid,text,text) to authenticated;
grant execute on function public.review_overtime_assignment(uuid,text,text) to authenticated;
grant execute on function public.generate_pay_period(uuid) to authenticated;
grant execute on function public.review_document_request(uuid,text,text) to authenticated;
