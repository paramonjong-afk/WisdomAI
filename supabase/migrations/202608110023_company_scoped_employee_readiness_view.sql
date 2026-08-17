-- Company-scoped workforce readiness used by WorkforceSetup and Health Monitor.
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
  ) as ready_to_clock,
  member.company_id
from public.company_members member
join public.profiles profile on profile.id=member.profile_id
left join public.employee_employment_records employment
  on employment.company_id=member.company_id and employment.profile_id=profile.id
left join lateral (
  select site_assignment.site_id from public.employee_site_assignments site_assignment
  where site_assignment.company_id=member.company_id
    and site_assignment.profile_id=profile.id
    and site_assignment.active
  order by site_assignment.created_at desc limit 1
) assignment on true
left join public.project_sites site
  on site.id=assignment.site_id and site.company_id=member.company_id
where member.active=true;

grant select on public.employee_onboarding_readiness to authenticated;

update public.system_work_items
set progress=60,current_step='workforce_readiness_view_fixed',production_status='migration_ready_for_production',updated_at=now()
where work_key='SYS-004' and status='doing';
