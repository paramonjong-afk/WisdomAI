-- Configurable attendance reminders, wage thresholds and safe employee lifecycle controls.

create table if not exists public.workforce_rule_settings (
  singleton boolean primary key default true check (singleton),
  daily_pay_mode text not null default 'day_tiers' check (daily_pay_mode in ('day_tiers','prorated_minutes')),
  full_day_minutes integer not null default 480 check (full_day_minutes between 60 and 1440),
  half_day_minutes integer not null default 240 check (half_day_minutes between 1 and 1439),
  below_half_day_daily_factor numeric(4,3) not null default 0 check (below_half_day_daily_factor between 0 and 1),
  monthly_partial_day_deduction_factor numeric(4,3) not null default 0.5 check (monthly_partial_day_deduction_factor between 0 and 1),
  monthly_below_half_day_deduction_factor numeric(4,3) not null default 1 check (monthly_below_half_day_deduction_factor between 0 and 1),
  monthly_salary_divisor integer not null default 30 check (monthly_salary_divisor between 1 and 31),
  first_period_salary_ratio numeric(5,4) not null default 0.5 check (first_period_salary_ratio between 0 and 1),
  attendance_day_cutoff time not null default time '00:00',
  clock_out_reminder_minutes integer not null default 180 check (clock_out_reminder_minutes between 0 and 720),
  stale_after_shift_minutes integer not null default 420 check (stale_after_shift_minutes between 60 and 1440),
  overtime_reminder_minutes integer not null default 60 check (overtime_reminder_minutes between 0 and 240),
  morning_summary_time time not null default time '07:00',
  line_group_id text,
  enabled boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (half_day_minutes < full_day_minutes)
);
insert into public.workforce_rule_settings(singleton) values(true) on conflict(singleton) do nothing;
update public.workforce_rule_settings
set line_group_id=coalesce(line_group_id,(select line_group_id from public.health_monitor_settings where singleton=true))
where singleton=true;
update public.attendance_system_settings set stale_session_mode='manager_review',updated_at=now() where singleton=true;

alter table public.workforce_rule_settings enable row level security;
create policy "Authenticated read workforce rules" on public.workforce_rule_settings
  for select to authenticated using(true);
create policy "Managers manage workforce rules" on public.workforce_rule_settings
  for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());

alter table public.leave_types
  add column if not exists allowed_employment_types text[] not null default array['daily','monthly','temporary'];

create table if not exists public.attendance_reminder_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  event_type text not null check(event_type in ('clock_out_reminder','stale_marked','morning_summary')),
  destination text,
  status text not null default 'pending' check(status in ('pending','sent','failed','skipped')),
  message text not null,
  error_message text,
  created_at timestamptz not null default now(),
  unique(session_id,event_type)
);
alter table public.attendance_reminder_events enable row level security;
create policy "Managers read attendance reminders" on public.attendance_reminder_events
  for select to authenticated using(public.is_work_manager());

create or replace function public.employee_delete_preview(target_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(select 1 from profiles where id=auth.uid() and role='admin') then raise exception 'Admin permission required'; end if;
  if target_profile_id=auth.uid() then raise exception 'ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่'; end if;
  select jsonb_build_object(
    'attendance', (select count(*) from attendance_sessions where profile_id=target_profile_id),
    'leave_requests', (select count(*) from employee_leave_requests where profile_id=target_profile_id),
    'overtime', (select count(*) from employee_overtime_assignments where profile_id=target_profile_id),
    'payrolls', (select count(*) from employee_payrolls where profile_id=target_profile_id),
    'documents', (select count(*) from employee_document_requests where profile_id=target_profile_id),
    'site_assignments', (select count(*) from employee_site_assignments where profile_id=target_profile_id),
    'can_delete', not exists(select 1 from attendance_sessions where profile_id=target_profile_id)
      and not exists(select 1 from employee_leave_requests where profile_id=target_profile_id)
      and not exists(select 1 from employee_overtime_assignments where profile_id=target_profile_id)
      and not exists(select 1 from employee_payrolls where profile_id=target_profile_id)
      and not exists(select 1 from employee_document_requests where profile_id=target_profile_id)
  ) into result;
  return result;
end;
$$;
grant execute on function public.employee_delete_preview(uuid) to authenticated;

create or replace function public.set_employee_active(target_profile_id uuid, make_active boolean, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare before_row employee_employment_records;
begin
  if not exists(select 1 from profiles where id=auth.uid() and role='admin') then raise exception 'Admin permission required'; end if;
  if nullif(trim(reason),'') is null then raise exception 'กรุณาระบุเหตุผล'; end if;
  if target_profile_id=auth.uid() and not make_active then raise exception 'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่'; end if;
  select * into before_row from employee_employment_records where profile_id=target_profile_id for update;
  if not found then raise exception 'ไม่พบข้อมูลการจ้างงาน'; end if;
  update employee_employment_records set
    employment_status=case when make_active then 'active' else 'archived' end,
    terminated_on=case when make_active then null else coalesce(terminated_on,current_date) end,
    updated_at=now()
  where profile_id=target_profile_id;
  update employee_site_assignments set active=make_active where profile_id=target_profile_id;
  insert into employee_workforce_audit_logs(profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values)
  values(target_profile_id,auth.uid(),'employee',target_profile_id,
    case when make_active then 'reactivate' else 'archive' end,trim(reason),to_jsonb(before_row),
    (select to_jsonb(e) from employee_employment_records e where e.profile_id=target_profile_id));
end;
$$;
grant execute on function public.set_employee_active(uuid,boolean,text) to authenticated;

-- Ensure monthly pay is split between the two configured pay periods instead of paying a full month twice.
create or replace function public.pay_period_monthly_ratio(period_start date)
returns numeric language sql stable set search_path=public as $$
  select case when extract(day from period_start)=1 then first_period_salary_ratio else 1-first_period_salary_ratio end
  from workforce_rule_settings where singleton=true
$$;

create or replace function public.generate_pay_period(target_pay_period_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare period pay_periods; employee employee_employment_records; rules workforce_rule_settings;
declare v_payroll_id uuid; normal_total integer; ot_total integer; paid_leave_total integer;
declare base_amount numeric(14,2); ot_amount numeric(14,2); add_amount numeric(14,2);
declare deduct_amount numeric(14,2); reimburse_amount numeric(14,2);
declare paid_work_units numeric; paid_leave_units numeric; deduction_units numeric; unresolved integer;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into period from pay_periods where id=target_pay_period_id for update;
  if not found then raise exception 'Pay period not found'; end if;
  if period.status in ('closed','paying','paid','cancelled') then raise exception 'Pay period is locked'; end if;
  select * into rules from workforce_rule_settings where singleton=true;
  update pay_periods set status='calculating',updated_at=now() where id=period.id;

  for employee in select * from employee_employment_records where employment_status in ('probation','active','notice') loop
    select coalesce(sum(normal_minutes),0),coalesce(sum(overtime_minutes),0),
      count(*) filter(where calculation_status='needs_review' or status in ('pending','needs_review') or clock_out_at is null)
    into normal_total,ot_total,unresolved
    from attendance_sessions where profile_id=employee.profile_id
      and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
      and status not in ('rejected','duplicate');

    select coalesce(sum(requested_minutes*paid_ratio),0)
    into paid_leave_total from employee_leave_requests request
    join leave_types leave_type on leave_type.id=request.leave_type_id
    where request.profile_id=employee.profile_id and request.status in ('approved','used')
      and employee.employment_type=any(leave_type.allowed_employment_types)
      and (request.starts_at at time zone 'Asia/Bangkok')::date<=period.ends_on
      and (request.ends_at at time zone 'Asia/Bangkok')::date>=period.starts_on;

    select coalesce(sum(case when day_minutes>=rules.full_day_minutes then 1
      when day_minutes>=rules.half_day_minutes then 0.5 else rules.below_half_day_daily_factor end),0)
    into paid_work_units from (
      select (clock_in_at at time zone 'Asia/Bangkok')::date,coalesce(sum(normal_minutes),0) day_minutes
      from attendance_sessions where profile_id=employee.profile_id
        and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
        and status in ('normal','approved') and calculation_status='calculated' group by 1
    ) daily;
    paid_leave_units:=paid_leave_total::numeric/rules.full_day_minutes;

    select coalesce(sum(case when day_minutes>=rules.full_day_minutes then 0
      when day_minutes>=rules.half_day_minutes then rules.monthly_partial_day_deduction_factor
      else rules.monthly_below_half_day_deduction_factor end),0)
    into deduction_units from (
      select (clock_in_at at time zone 'Asia/Bangkok')::date,coalesce(sum(normal_minutes),0) day_minutes
      from attendance_sessions where profile_id=employee.profile_id
        and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
        and status in ('normal','approved') and calculation_status='calculated' group by 1
    ) partial_days;

    if employee.employment_type='monthly' then
      base_amount:=round(employee.monthly_salary*public.pay_period_monthly_ratio(period.starts_on),2);
      deduct_amount:=round(deduction_units*(employee.monthly_salary/rules.monthly_salary_divisor),2);
    else
      base_amount:=case when rules.daily_pay_mode='prorated_minutes'
        then round(((normal_total+paid_leave_total)::numeric/rules.full_day_minutes)*employee.daily_rate,2)
        else round((paid_work_units+paid_leave_units)*employee.daily_rate,2) end;
      deduct_amount:=0;
    end if;
    ot_amount:=round((ot_total::numeric/60)*employee.overtime_hourly_rate,2);
    select coalesce(sum(amount) filter(where adjustment_type in ('allowance','bonus')),0),
      coalesce(sum(amount) filter(where adjustment_type in ('wage_advance','cash_advance','deduction')),0)+deduct_amount,
      coalesce(sum(amount) filter(where adjustment_type='reimbursement'),0)
    into add_amount,deduct_amount,reimburse_amount from employee_pay_adjustments
    where profile_id=employee.profile_id and effective_date between period.starts_on and period.ends_on and status in ('approved','paid');

    insert into employee_payrolls(pay_period_id,profile_id,normal_minutes,overtime_minutes,base_pay,overtime_pay,additions,deductions,reimbursements,net_pay,status)
    values(period.id,employee.profile_id,normal_total,ot_total,base_amount,ot_amount,add_amount,deduct_amount,reimburse_amount,
      base_amount+ot_amount+add_amount+reimburse_amount-deduct_amount,case when unresolved>0 then 'needs_review' else 'estimated' end)
    on conflict(pay_period_id,profile_id) do update set normal_minutes=excluded.normal_minutes,overtime_minutes=excluded.overtime_minutes,
      base_pay=excluded.base_pay,overtime_pay=excluded.overtime_pay,additions=excluded.additions,deductions=excluded.deductions,
      reimbursements=excluded.reimbursements,net_pay=excluded.net_pay,
      status=case when employee_payrolls.status in ('closed','paid') then employee_payrolls.status else excluded.status end,updated_at=now()
    returning id into v_payroll_id;
    delete from employee_payroll_lines where payroll_id=v_payroll_id;
    insert into employee_payroll_lines(payroll_id,line_type,description,quantity,rate,amount) values
      (v_payroll_id,'base_pay','ค่าจ้างปกติ',case when employee.employment_type='monthly' then public.pay_period_monthly_ratio(period.starts_on) else paid_work_units+paid_leave_units end,case when employee.employment_type='monthly' then employee.monthly_salary else employee.daily_rate end,base_amount),
      (v_payroll_id,'overtime','ค่า OT ที่อนุมัติ',ot_total,employee.overtime_hourly_rate,ot_amount),
      (v_payroll_id,'deduction','หักเวลาทำงานไม่ครบ',deduction_units,employee.monthly_salary/rules.monthly_salary_divisor,-deduct_amount);
  end loop;
  update pay_periods set status='review',updated_at=now() where id=period.id;
end;
$$;
grant execute on function public.generate_pay_period(uuid) to authenticated;

comment on table public.workforce_rule_settings is 'Company-level configurable rules for attendance reminders and wage day thresholds.';

create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
begin
  if exists(select 1 from cron.job where jobname='wisdomai-attendance-reminders') then
    perform cron.unschedule('wisdomai-attendance-reminders');
  end if;
  perform cron.schedule(
    'wisdomai-attendance-reminders','*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/attendance-reminders',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end $$;
