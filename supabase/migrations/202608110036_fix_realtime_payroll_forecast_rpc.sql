-- PAYROLL-FORECAST-001: make the forecast RPC deterministic across tenant data variants.
create or replace function public.get_realtime_payroll_forecast(target_month date)
returns table(profile_id uuid, employee_name text, employment_type text, attendance_policy text,
  actual_normal_minutes bigint, actual_overtime_minutes bigint, future_planned_minutes bigint,
  future_planned_overtime_minutes bigint, accrued_cost numeric, committed_cost numeric,
  forecast_month_end numeric, missing_data text[], as_of timestamptz)
language plpgsql security definer set search_path=public as $$
declare
  v_company_id uuid := public.current_company_id();
  month_start date := date_trunc('month', target_month)::date;
  month_end date := (date_trunc('month', target_month) + interval '1 month - 1 day')::date;
  cutoff date := least(current_date, (date_trunc('month', target_month) + interval '1 month - 1 day')::date);
begin
  if v_company_id is null or not public.is_work_manager() then raise exception 'Permission denied'; end if;
  return query with employees as (
    select e.profile_id, coalesce(p.full_name,p.email,'-')::text employee_name,
      e.employment_type::text employment_type, e.attendance_policy::text attendance_policy, e.work_policy_id,
      coalesce(rate.daily_rate,e.daily_rate,0)::numeric daily_rate,
      coalesce(rate.monthly_salary,e.monthly_salary,0)::numeric monthly_salary,
      coalesce(rate.overtime_hourly_rate,e.overtime_hourly_rate,0)::numeric ot_rate
    from public.employee_employment_records e join public.profiles p on p.id=e.profile_id
    left join lateral (
      select h.* from public.employee_compensation_rates h
      where h.company_id=v_company_id and h.profile_id=e.profile_id and h.effective_on<=cutoff
        and (h.ends_on is null or h.ends_on>=month_start)
      order by h.effective_on desc limit 1
    ) rate on true
    where e.company_id=v_company_id and e.employment_status in ('probation','active','notice')
  ), actual as (
    select s.profile_id, coalesce(sum(s.normal_minutes),0)::bigint normal_minutes,
      coalesce(sum(s.overtime_minutes),0)::bigint overtime_minutes
    from public.attendance_sessions s where s.company_id=v_company_id
      and (s.clock_in_at at time zone 'Asia/Bangkok')::date between month_start and cutoff
      and s.status in ('normal','approved') and s.calculation_status='calculated' group by s.profile_id
  ), plans as (
    select p.profile_id,coalesce(sum(p.planned_normal_minutes),0)::bigint normal_minutes,
      coalesce(sum(p.planned_overtime_minutes),0)::bigint overtime_minutes
    from public.workforce_daily_plans p where p.company_id=v_company_id and p.work_date>cutoff
      and p.work_date<=month_end and p.status in ('planned','confirmed') group by p.profile_id
  ), rules as (
    select coalesce((select wrs.full_day_minutes from public.workforce_rule_settings wrs
      where wrs.company_id=v_company_id and wrs.singleton=true limit 1),480)::numeric full_day_minutes
  )
  select e.profile_id::uuid,e.employee_name::text,e.employment_type::text,e.attendance_policy::text,
    coalesce(a.normal_minutes,0)::bigint,coalesce(a.overtime_minutes,0)::bigint,
    coalesce(pl.normal_minutes,0)::bigint,coalesce(pl.overtime_minutes,0)::bigint,
    round((case when e.employment_type='monthly' then e.monthly_salary*(greatest(0,cutoff-month_start+1)::numeric/greatest(1,month_end-month_start+1)) else coalesce(a.normal_minutes,0)::numeric/r.full_day_minutes*e.daily_rate end)+coalesce(a.overtime_minutes,0)::numeric/60*e.ot_rate,2)::numeric,
    round((case when e.employment_type='monthly' then e.monthly_salary else (coalesce(a.normal_minutes,0)+coalesce(pl.normal_minutes,0))::numeric/r.full_day_minutes*e.daily_rate end)+(coalesce(a.overtime_minutes,0)+coalesce(pl.overtime_minutes,0))::numeric/60*e.ot_rate,2)::numeric,
    round((case when e.employment_type='monthly' then e.monthly_salary else (coalesce(a.normal_minutes,0)+coalesce(pl.normal_minutes,0))::numeric/r.full_day_minutes*e.daily_rate end)+(coalesce(a.overtime_minutes,0)+coalesce(pl.overtime_minutes,0))::numeric/60*e.ot_rate,2)::numeric,
    array_remove(array[case when e.work_policy_id is null then 'work_policy' end,
      case when e.employment_type='monthly' and e.monthly_salary<=0 then 'monthly_salary' end,
      case when e.employment_type<>'monthly' and e.daily_rate<=0 then 'daily_rate' end,
      case when e.attendance_policy<>'exempt' and coalesce(pl.normal_minutes,0)=0 and cutoff<month_end then 'future_plan' end],null)::text[],
    now()::timestamptz
  from employees e cross join rules r left join actual a on a.profile_id=e.profile_id
  left join plans pl on pl.profile_id=e.profile_id order by e.employee_name;
end $$;
revoke all on function public.get_realtime_payroll_forecast(date) from public,anon;
grant execute on function public.get_realtime_payroll_forecast(date) to authenticated;
update public.system_work_items set status='review',progress=greatest(progress,85),
  current_step='awaiting_rpc_fix_migration_approval',production_status='production_uat_failed_rpc_fix_prepared',
  evidence=concat_ws(E'\n',nullif(evidence,''),'Production UAT exposed forecast RPC return/default-rule compatibility issue; migration 202608110036 prepared.'),updated_at=now()
where work_key='PAYROLL-FORECAST-001';
