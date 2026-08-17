-- Employee readiness and immutable paid-period controls.

create or replace view public.employee_onboarding_readiness
with (security_invoker=true) as
select
  profile.id as profile_id,
  profile.full_name,
  profile.email,
  employment.employee_code,
  employment.employment_status,
  (nullif(trim(profile.full_name),'') is not null) as has_name,
  (employment.profile_id is not null) as has_employment,
  (case when employment.employment_type='monthly' then employment.monthly_salary>0 else employment.daily_rate>0 end) as has_pay_rate,
  (employment.overtime_hourly_rate>0) as has_ot_rate,
  (coalesce(employment.work_policy_id,site.work_policy_id) is not null) as has_work_policy,
  (assignment.site_id is not null) as has_site,
  (
    nullif(trim(profile.full_name),'') is not null
    and employment.profile_id is not null
    and case when employment.employment_type='monthly' then employment.monthly_salary>0 else employment.daily_rate>0 end
    and coalesce(employment.work_policy_id,site.work_policy_id) is not null
    and assignment.site_id is not null
  ) as ready_to_clock
from public.profiles profile
left join public.employee_employment_records employment on employment.profile_id=profile.id
left join lateral (
  select site_assignment.site_id from public.employee_site_assignments site_assignment
  where site_assignment.profile_id=profile.id and site_assignment.active
  order by site_assignment.created_at desc limit 1
) assignment on true
left join public.project_sites site on site.id=assignment.site_id;

grant select on public.employee_onboarding_readiness to authenticated;

create or replace function public.protect_locked_attendance()
returns trigger language plpgsql set search_path=public as $$
begin
  if exists(
    select 1 from public.employee_payrolls payroll
    join public.pay_periods period on period.id=payroll.pay_period_id
    where payroll.profile_id=old.profile_id
      and (old.clock_in_at at time zone 'Asia/Bangkok')::date between period.starts_on and period.ends_on
      and (payroll.status in ('closed','pending_payment','paid') or period.status in ('closed','paying','paid'))
  ) then
    raise exception 'รอบค่าจ้างนี้ปิดหรือจ่ายแล้ว กรุณาสร้างรายการปรับปรุงแทนการแก้เวลาเดิม';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_locked_attendance on public.attendance_sessions;
create trigger protect_locked_attendance before update or delete on public.attendance_sessions
for each row execute function public.protect_locked_attendance();

create or replace function public.protect_paid_contractor_claim()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='paid' then
    raise exception 'งวดผู้รับเหมาจ่ายแล้ว กรุณาสร้างรายการปรับปรุงใหม่';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_paid_contractor_claim on public.contractor_payment_claims;
create trigger protect_paid_contractor_claim before update or delete on public.contractor_payment_claims
for each row execute function public.protect_paid_contractor_claim();

