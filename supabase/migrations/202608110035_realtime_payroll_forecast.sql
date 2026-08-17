-- PAYROLL-FORECAST-001: explainable real-time labor accrual and month-end forecast.
-- Forecast data is separate from approved payroll and payslips.
create table if not exists public.employee_compensation_rates (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade, effective_on date not null, ends_on date,
  employment_type text not null check(employment_type in ('daily','monthly','temporary','contractor')),
  daily_rate numeric(12,2) not null default 0 check(daily_rate>=0), monthly_salary numeric(12,2) not null default 0 check(monthly_salary>=0),
  overtime_hourly_rate numeric(12,2) not null default 0 check(overtime_hourly_rate>=0), reason text not null default 'current employment rate',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(), created_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=effective_on), unique(company_id,profile_id,effective_on)
);
create table if not exists public.workforce_daily_plans (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade, site_id uuid references public.project_sites(id) on delete set null,
  work_date date not null, planned_normal_minutes integer not null default 0 check(planned_normal_minutes between 0 and 1440),
  planned_overtime_minutes integer not null default 0 check(planned_overtime_minutes between 0 and 720),
  status text not null default 'planned' check(status in ('draft','planned','confirmed','cancelled','completed')), note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id,profile_id,work_date,site_id)
);
create index if not exists employee_compensation_rates_lookup_idx on public.employee_compensation_rates(company_id,profile_id,effective_on desc);
create index if not exists workforce_daily_plans_company_date_idx on public.workforce_daily_plans(company_id,work_date,profile_id);
insert into public.employee_compensation_rates(company_id,profile_id,effective_on,employment_type,daily_rate,monthly_salary,overtime_hourly_rate)
select company_id,profile_id,coalesce(hired_on,current_date),employment_type,daily_rate,monthly_salary,overtime_hourly_rate
from public.employee_employment_records where company_id is not null on conflict(company_id,profile_id,effective_on) do nothing;
create or replace function public.capture_employee_compensation_rate() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' or (new.employment_type,new.daily_rate,new.monthly_salary,new.overtime_hourly_rate) is distinct from (old.employment_type,old.daily_rate,old.monthly_salary,old.overtime_hourly_rate) then
    insert into employee_compensation_rates(company_id,profile_id,effective_on,employment_type,daily_rate,monthly_salary,overtime_hourly_rate,reason,created_by)
    values(new.company_id,new.profile_id,current_date,new.employment_type,new.daily_rate,new.monthly_salary,new.overtime_hourly_rate,'employment record changed',auth.uid())
    on conflict(company_id,profile_id,effective_on) do update set employment_type=excluded.employment_type,daily_rate=excluded.daily_rate,monthly_salary=excluded.monthly_salary,overtime_hourly_rate=excluded.overtime_hourly_rate,reason=excluded.reason,created_by=excluded.created_by,created_at=now();
  end if; return new;
end $$;
drop trigger if exists capture_employee_compensation_rate_trigger on public.employee_employment_records;
create trigger capture_employee_compensation_rate_trigger after insert or update of employment_type,daily_rate,monthly_salary,overtime_hourly_rate on public.employee_employment_records for each row execute function public.capture_employee_compensation_rate();
alter table public.employee_compensation_rates enable row level security; alter table public.workforce_daily_plans enable row level security;
create policy "Managers read compensation history" on public.employee_compensation_rates for select to authenticated using(company_id=public.current_company_id() and public.is_work_manager());
create policy "Managers manage compensation history" on public.employee_compensation_rates for all to authenticated using(company_id=public.current_company_id() and public.is_work_manager()) with check(company_id=public.current_company_id() and public.is_work_manager());
create policy "Company members read workforce plans" on public.workforce_daily_plans for select to authenticated using(company_id=public.current_company_id() and (profile_id=auth.uid() or public.is_work_manager()));
create policy "Managers manage workforce plans" on public.workforce_daily_plans for all to authenticated using(company_id=public.current_company_id() and public.is_work_manager()) with check(company_id=public.current_company_id() and public.is_work_manager());
create or replace function public.get_realtime_payroll_forecast(target_month date)
returns table(profile_id uuid,employee_name text,employment_type text,attendance_policy text,actual_normal_minutes bigint,actual_overtime_minutes bigint,future_planned_minutes bigint,future_planned_overtime_minutes bigint,accrued_cost numeric,committed_cost numeric,forecast_month_end numeric,missing_data text[],as_of timestamptz)
language plpgsql security definer set search_path=public as $$
declare v_company_id uuid:=public.current_company_id(); month_start date:=date_trunc('month',target_month)::date; month_end date:=(date_trunc('month',target_month)+interval '1 month-1 day')::date; cutoff date:=least(current_date,(date_trunc('month',target_month)+interval '1 month-1 day')::date);
begin
  if v_company_id is null or not public.is_work_manager() then raise exception 'Permission denied'; end if;
  return query with employees as (
    select e.profile_id,coalesce(p.full_name,p.email,'-') employee_name,e.employment_type,e.attendance_policy,e.work_policy_id,
      coalesce(rate.daily_rate,e.daily_rate,0) daily_rate,coalesce(rate.monthly_salary,e.monthly_salary,0) monthly_salary,coalesce(rate.overtime_hourly_rate,e.overtime_hourly_rate,0) ot_rate
    from employee_employment_records e join profiles p on p.id=e.profile_id left join lateral (
      select h.* from employee_compensation_rates h where h.company_id=v_company_id and h.profile_id=e.profile_id and h.effective_on<=cutoff and (h.ends_on is null or h.ends_on>=month_start) order by h.effective_on desc limit 1
    ) rate on true where e.company_id=v_company_id and e.employment_status in ('probation','active','notice')
  ), actual as (
    select s.profile_id,coalesce(sum(s.normal_minutes),0)::bigint normal_minutes,coalesce(sum(s.overtime_minutes),0)::bigint overtime_minutes from attendance_sessions s
    where s.company_id=v_company_id and (s.clock_in_at at time zone 'Asia/Bangkok')::date between month_start and cutoff and s.status in ('normal','approved') and s.calculation_status='calculated' group by s.profile_id
  ), plans as (
    select p.profile_id,coalesce(sum(p.planned_normal_minutes),0)::bigint normal_minutes,coalesce(sum(p.planned_overtime_minutes),0)::bigint overtime_minutes from workforce_daily_plans p
    where p.company_id=v_company_id and p.work_date>cutoff and p.work_date<=month_end and p.status in ('planned','confirmed') group by p.profile_id
  ), rules as (select coalesce(full_day_minutes,480)::numeric full_day_minutes from workforce_rule_settings where company_id=v_company_id and singleton=true)
  select e.profile_id,e.employee_name,e.employment_type,e.attendance_policy,coalesce(a.normal_minutes,0),coalesce(a.overtime_minutes,0),coalesce(pl.normal_minutes,0),coalesce(pl.overtime_minutes,0),
    round((case when e.employment_type='monthly' then e.monthly_salary*(greatest(0,cutoff-month_start+1)::numeric/greatest(1,month_end-month_start+1)) else coalesce(a.normal_minutes,0)/r.full_day_minutes*e.daily_rate end)+coalesce(a.overtime_minutes,0)::numeric/60*e.ot_rate,2),
    round((case when e.employment_type='monthly' then e.monthly_salary else (coalesce(a.normal_minutes,0)+coalesce(pl.normal_minutes,0))/r.full_day_minutes*e.daily_rate end)+(coalesce(a.overtime_minutes,0)+coalesce(pl.overtime_minutes,0))::numeric/60*e.ot_rate,2),
    round((case when e.employment_type='monthly' then e.monthly_salary else (coalesce(a.normal_minutes,0)+coalesce(pl.normal_minutes,0))/r.full_day_minutes*e.daily_rate end)+(coalesce(a.overtime_minutes,0)+coalesce(pl.overtime_minutes,0))::numeric/60*e.ot_rate,2),
    array_remove(array[case when e.work_policy_id is null then 'work_policy' end,case when e.employment_type='monthly' and e.monthly_salary<=0 then 'monthly_salary' end,case when e.employment_type<>'monthly' and e.daily_rate<=0 then 'daily_rate' end,case when e.attendance_policy<>'exempt' and coalesce(pl.normal_minutes,0)=0 and cutoff<month_end then 'future_plan' end],null)::text[],now()
  from employees e cross join rules r left join actual a on a.profile_id=e.profile_id left join plans pl on pl.profile_id=e.profile_id order by e.employee_name;
end $$;
revoke all on function public.get_realtime_payroll_forecast(date) from public,anon; grant execute on function public.get_realtime_payroll_forecast(date) to authenticated;
insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,production_status,current_step,evidence)
values('PAYROLL-FORECAST-001','ค่าแรง Real-time และประมาณการสิ้นเดือน','report','review',70,'high','ประวัติอัตราค่าจ้าง แผนกำลังคนรายวัน และ Forecast แยกจาก Payroll/Payslip ที่ล็อกแล้ว','migration_ready_for_production','awaiting_migration_approval','Migration 202608110035 prepared; tenant RLS and manager-only forecast RPC included.')
on conflict(work_key) do update set status='review',progress=70,risk='high',detail=excluded.detail,production_status=excluded.production_status,current_step=excluded.current_step,evidence=excluded.evidence,updated_at=now();
