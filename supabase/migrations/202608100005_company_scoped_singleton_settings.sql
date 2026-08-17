-- TEN-006: make singleton settings and payroll calculations company scoped.

alter table public.attendance_system_settings drop constraint if exists attendance_system_settings_pkey;
alter table public.pay_cycle_settings drop constraint if exists pay_cycle_settings_pkey;
alter table public.workforce_rule_settings drop constraint if exists workforce_rule_settings_pkey;

alter table public.attendance_system_settings add primary key(company_id,singleton);
alter table public.pay_cycle_settings add primary key(company_id,singleton);
alter table public.workforce_rule_settings add primary key(company_id,singleton);

insert into public.attendance_system_settings(
  company_id,singleton,max_gps_accuracy_meters,allow_outside_site_for_review,
  shared_devices_allowed,stale_session_mode
)
select company.id,true,template.max_gps_accuracy_meters,template.allow_outside_site_for_review,
  template.shared_devices_allowed,template.stale_session_mode
from public.companies company
cross join lateral (
  select max_gps_accuracy_meters,allow_outside_site_for_review,shared_devices_allowed,stale_session_mode
  from public.attendance_system_settings order by updated_at desc limit 1
) template
on conflict(company_id,singleton) do nothing;

insert into public.pay_cycle_settings(
  company_id,singleton,first_period_end_day,first_pay_day,second_pay_day,
  second_pay_month_offset,holiday_adjustment,active
)
select company.id,true,template.first_period_end_day,template.first_pay_day,template.second_pay_day,
  template.second_pay_month_offset,template.holiday_adjustment,template.active
from public.companies company
cross join lateral (
  select first_period_end_day,first_pay_day,second_pay_day,second_pay_month_offset,holiday_adjustment,active
  from public.pay_cycle_settings order by updated_at desc limit 1
) template
on conflict(company_id,singleton) do nothing;

insert into public.workforce_rule_settings(
  company_id,singleton,daily_pay_mode,full_day_minutes,half_day_minutes,
  below_half_day_daily_factor,monthly_partial_day_deduction_factor,
  monthly_below_half_day_deduction_factor,monthly_salary_divisor,
  first_period_salary_ratio,attendance_day_cutoff,clock_out_reminder_minutes,
  stale_after_shift_minutes,overtime_reminder_minutes,morning_summary_time,
  line_group_id,enabled
)
select company.id,true,template.daily_pay_mode,template.full_day_minutes,template.half_day_minutes,
  template.below_half_day_daily_factor,template.monthly_partial_day_deduction_factor,
  template.monthly_below_half_day_deduction_factor,template.monthly_salary_divisor,
  template.first_period_salary_ratio,template.attendance_day_cutoff,template.clock_out_reminder_minutes,
  template.stale_after_shift_minutes,template.overtime_reminder_minutes,template.morning_summary_time,
  template.line_group_id,template.enabled
from public.companies company
cross join lateral (
  select * from public.workforce_rule_settings order by updated_at desc limit 1
) template
on conflict(company_id,singleton) do nothing;

create or replace function public.seed_company_singleton_settings()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into attendance_system_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  insert into pay_cycle_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  insert into workforce_rule_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  return new;
end;
$$;
drop trigger if exists seed_company_singleton_settings on public.companies;
create trigger seed_company_singleton_settings after insert on public.companies
for each row execute function public.seed_company_singleton_settings();

alter table public.pay_periods drop constraint if exists pay_periods_starts_on_ends_on_key;
create unique index if not exists pay_periods_company_dates_key
  on public.pay_periods(company_id,starts_on,ends_on);

create or replace function public.adjust_pay_date(target_date date,adjustment text,target_company_id uuid)
returns date language plpgsql stable set search_path=public as $$
declare result_date date:=target_date;
declare direction integer:=case when adjustment='previous_workday' then -1 else 1 end;
begin
  if adjustment='none' then return result_date; end if;
  while extract(isodow from result_date)::integer in (6,7)
    or exists(select 1 from company_holidays where company_id=target_company_id and holiday_date=result_date and site_id is null)
  loop result_date:=result_date+direction; end loop;
  return result_date;
end;
$$;

create or replace function public.ensure_semimonthly_pay_periods(target_year integer,target_month integer)
returns setof public.pay_periods language plpgsql security definer set search_path=public as $$
declare setting pay_cycle_settings; v_company_id uuid:=public.current_company_id();
declare month_start date; month_end date; first_end date; first_pay date; second_pay date; created pay_periods;
begin
  if auth.uid() is not null and not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if v_company_id is null then raise exception 'Company is required'; end if;
  if target_year not between 2000 and 2200 or target_month not between 1 and 12 then raise exception 'Invalid month'; end if;
  select * into setting from pay_cycle_settings where pay_cycle_settings.company_id=v_company_id and singleton=true;
  if not found then raise exception 'Pay cycle settings not found'; end if;
  month_start:=make_date(target_year,target_month,1);
  month_end:=(month_start+interval '1 month'-interval '1 day')::date;
  first_end:=least(month_end,make_date(target_year,target_month,setting.first_period_end_day));
  first_pay:=public.adjust_pay_date(make_date(target_year,target_month,setting.first_pay_day),setting.holiday_adjustment,v_company_id);
  second_pay:=public.adjust_pay_date((month_start+make_interval(months=>setting.second_pay_month_offset)+(setting.second_pay_day-1)*interval '1 day')::date,setting.holiday_adjustment,v_company_id);
  insert into pay_periods(company_id,name,starts_on,ends_on,pay_date)
  values(v_company_id,format('รอบ 1-%s %s',setting.first_period_end_day,to_char(month_start,'MM/YYYY')),month_start,first_end,first_pay)
  on conflict(company_id,starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
  returning * into created; return next created;
  if first_end<month_end then
    insert into pay_periods(company_id,name,starts_on,ends_on,pay_date)
    values(v_company_id,format('รอบ %s-สิ้นเดือน %s',setting.first_period_end_day+1,to_char(month_start,'MM/YYYY')),first_end+1,month_end,second_pay)
    on conflict(company_id,starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
    returning * into created; return next created;
  end if;
end;
$$;

create or replace function public.pay_period_monthly_ratio(period_start date,target_company_id uuid)
returns numeric language sql stable set search_path=public as $$
  select case when extract(day from period_start)=1 then first_period_salary_ratio else 1-first_period_salary_ratio end
  from workforce_rule_settings where company_id=target_company_id and singleton=true
$$;

create or replace function public.pay_period_monthly_ratio(period_start date)
returns numeric language sql stable set search_path=public as $$
  select public.pay_period_monthly_ratio(period_start,public.current_company_id())
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
  select * into period from pay_periods where id=target_pay_period_id and company_id=public.current_company_id() for update;
  if not found then raise exception 'Pay period not found'; end if;
  if period.status in ('closed','paying','paid','cancelled') then raise exception 'Pay period is locked'; end if;
  select * into rules from workforce_rule_settings where company_id=period.company_id and singleton=true;
  if not found then raise exception 'Workforce rule settings not found'; end if;
  update pay_periods set status='calculating',updated_at=now() where id=period.id and company_id=period.company_id;
  for employee in select * from employee_employment_records
    where company_id=period.company_id and employment_status in ('probation','active','notice') loop
    select coalesce(sum(normal_minutes),0),coalesce(sum(overtime_minutes),0),
      count(*) filter(where calculation_status='needs_review' or status in ('pending','needs_review') or clock_out_at is null)
    into normal_total,ot_total,unresolved from attendance_sessions
    where company_id=period.company_id and profile_id=employee.profile_id
      and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
      and status not in ('rejected','duplicate');
    select coalesce(sum(requested_minutes*paid_ratio),0) into paid_leave_total
    from employee_leave_requests request join leave_types leave_type
      on leave_type.id=request.leave_type_id and leave_type.company_id=period.company_id
    where request.company_id=period.company_id and request.profile_id=employee.profile_id and request.status in ('approved','used')
      and employee.employment_type=any(leave_type.allowed_employment_types)
      and (request.starts_at at time zone 'Asia/Bangkok')::date<=period.ends_on
      and (request.ends_at at time zone 'Asia/Bangkok')::date>=period.starts_on;
    select coalesce(sum(case when day_minutes>=rules.full_day_minutes then 1 when day_minutes>=rules.half_day_minutes then 0.5 else rules.below_half_day_daily_factor end),0)
    into paid_work_units from (
      select (clock_in_at at time zone 'Asia/Bangkok')::date,coalesce(sum(normal_minutes),0) day_minutes
      from attendance_sessions where company_id=period.company_id and profile_id=employee.profile_id
        and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
        and status in ('normal','approved') and calculation_status='calculated' group by 1
    ) daily;
    paid_leave_units:=paid_leave_total::numeric/rules.full_day_minutes;
    select coalesce(sum(case when day_minutes>=rules.full_day_minutes then 0 when day_minutes>=rules.half_day_minutes then rules.monthly_partial_day_deduction_factor else rules.monthly_below_half_day_deduction_factor end),0)
    into deduction_units from (
      select (clock_in_at at time zone 'Asia/Bangkok')::date,coalesce(sum(normal_minutes),0) day_minutes
      from attendance_sessions where company_id=period.company_id and profile_id=employee.profile_id
        and (clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
        and status in ('normal','approved') and calculation_status='calculated' group by 1
    ) partial_days;
    if employee.employment_type='monthly' then
      base_amount:=round(employee.monthly_salary*public.pay_period_monthly_ratio(period.starts_on,period.company_id),2);
      deduct_amount:=round(deduction_units*(employee.monthly_salary/rules.monthly_salary_divisor),2);
    else
      base_amount:=case when rules.daily_pay_mode='prorated_minutes' then round(((normal_total+paid_leave_total)::numeric/rules.full_day_minutes)*employee.daily_rate,2)
        else round((paid_work_units+paid_leave_units)*employee.daily_rate,2) end; deduct_amount:=0;
    end if;
    ot_amount:=round((ot_total::numeric/60)*employee.overtime_hourly_rate,2);
    select coalesce(sum(amount) filter(where adjustment_type in ('allowance','bonus')),0),
      coalesce(sum(amount) filter(where adjustment_type in ('wage_advance','cash_advance','deduction')),0)+deduct_amount,
      coalesce(sum(amount) filter(where adjustment_type='reimbursement'),0)
    into add_amount,deduct_amount,reimburse_amount from employee_pay_adjustments
    where company_id=period.company_id and profile_id=employee.profile_id and effective_date between period.starts_on and period.ends_on and status in ('approved','paid');
    insert into employee_payrolls(company_id,pay_period_id,profile_id,normal_minutes,overtime_minutes,base_pay,overtime_pay,additions,deductions,reimbursements,net_pay,status)
    values(period.company_id,period.id,employee.profile_id,normal_total,ot_total,base_amount,ot_amount,add_amount,deduct_amount,reimburse_amount,
      base_amount+ot_amount+add_amount+reimburse_amount-deduct_amount,case when unresolved>0 then 'needs_review' else 'estimated' end)
    on conflict(pay_period_id,profile_id) do update set normal_minutes=excluded.normal_minutes,overtime_minutes=excluded.overtime_minutes,
      base_pay=excluded.base_pay,overtime_pay=excluded.overtime_pay,additions=excluded.additions,deductions=excluded.deductions,
      reimbursements=excluded.reimbursements,net_pay=excluded.net_pay,
      status=case when employee_payrolls.status in ('closed','paid') then employee_payrolls.status else excluded.status end,updated_at=now()
    returning id into v_payroll_id;
    delete from employee_payroll_lines where company_id=period.company_id and payroll_id=v_payroll_id;
    insert into employee_payroll_lines(company_id,payroll_id,line_type,description,quantity,rate,amount) values
      (period.company_id,v_payroll_id,'base_pay','ค่าจ้างปกติ',case when employee.employment_type='monthly' then public.pay_period_monthly_ratio(period.starts_on,period.company_id) else paid_work_units+paid_leave_units end,case when employee.employment_type='monthly' then employee.monthly_salary else employee.daily_rate end,base_amount),
      (period.company_id,v_payroll_id,'overtime','ค่า OT ที่อนุมัติ',ot_total,employee.overtime_hourly_rate,ot_amount),
      (period.company_id,v_payroll_id,'deduction','หักเวลาทำงานไม่ครบ',deduction_units,employee.monthly_salary/rules.monthly_salary_divisor,-deduct_amount);
  end loop;
  update pay_periods set status='review',updated_at=now() where id=period.id and company_id=period.company_id;
end;
$$;

grant execute on function public.adjust_pay_date(date,text,uuid) to authenticated;
grant execute on function public.pay_period_monthly_ratio(date,uuid) to authenticated;
grant execute on function public.ensure_semimonthly_pay_periods(integer,integer) to authenticated;
grant execute on function public.generate_pay_period(uuid) to authenticated;
