-- Effective-dated multi-site assignments and immutable attendance policy snapshots.
alter table public.employee_site_assignments add column if not exists id uuid default gen_random_uuid();
update public.employee_site_assignments set id=gen_random_uuid() where id is null;
alter table public.employee_site_assignments alter column id set not null;
alter table public.employee_site_assignments drop constraint if exists employee_site_assignments_pkey;
alter table public.employee_site_assignments add constraint employee_site_assignments_pkey primary key(id);
alter table public.employee_site_assignments
  add column if not exists work_policy_id uuid references public.work_policies(id) on delete set null,
  add column if not exists is_primary boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists employee_site_assignment_period_key
  on public.employee_site_assignments(company_id,profile_id,site_id,starts_on);
create index if not exists employee_site_assignment_effective_idx
  on public.employee_site_assignments(company_id,profile_id,starts_on,ends_on) where active;

create or replace function public.assign_employee_site(
  target_profile_id uuid,target_site_id uuid,target_starts_on date default current_date,
  target_ends_on date default null,target_work_policy_id uuid default null,target_is_primary boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare target_company_id uuid:=public.current_company_id(); assignment_id uuid;
begin
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'manager_permission_required'; end if;
  if target_ends_on is not null and target_ends_on<target_starts_on then raise exception 'invalid_assignment_period'; end if;
  if not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=target_profile_id and active) then raise exception 'employee_not_in_company'; end if;
  if not exists(select 1 from public.project_sites where company_id=target_company_id and id=target_site_id) then raise exception 'site_not_in_company'; end if;
  if target_work_policy_id is not null and not exists(select 1 from public.work_policies where company_id=target_company_id and id=target_work_policy_id) then raise exception 'policy_not_in_company'; end if;
  if target_is_primary then
    update public.employee_site_assignments set ends_on=target_starts_on-1,active=(target_starts_on-1)>=starts_on,is_primary=false,updated_at=now()
    where company_id=target_company_id and profile_id=target_profile_id and active and is_primary
      and starts_on<target_starts_on and (ends_on is null or ends_on>=target_starts_on);
  end if;
  insert into public.employee_site_assignments(company_id,profile_id,site_id,starts_on,ends_on,active,assigned_by,work_policy_id,is_primary)
  values(target_company_id,target_profile_id,target_site_id,target_starts_on,target_ends_on,true,auth.uid(),target_work_policy_id,target_is_primary)
  on conflict(company_id,profile_id,site_id,starts_on) do update set ends_on=excluded.ends_on,active=true,
    assigned_by=excluded.assigned_by,work_policy_id=excluded.work_policy_id,is_primary=excluded.is_primary,updated_at=now()
  returning id into assignment_id;
  return assignment_id;
end;$$;
revoke all on function public.assign_employee_site(uuid,uuid,date,date,uuid,boolean) from public,anon;
grant execute on function public.assign_employee_site(uuid,uuid,date,date,uuid,boolean) to authenticated;

-- Existing single-site employees keep a deterministic primary assignment.
with ranked as (
  select id,row_number() over(partition by company_id,profile_id order by starts_on desc,created_at desc,id) as position
  from public.employee_site_assignments where active and (ends_on is null or ends_on>=current_date)
)
update public.employee_site_assignments assignment set is_primary=true
from ranked where assignment.id=ranked.id and ranked.position=1
  and not exists(select 1 from public.employee_site_assignments current_primary
    where current_primary.company_id=assignment.company_id and current_primary.profile_id=assignment.profile_id
      and current_primary.active and current_primary.is_primary and (current_primary.ends_on is null or current_primary.ends_on>=current_date));

alter table public.attendance_sessions
  add column if not exists assignment_id uuid references public.employee_site_assignments(id) on delete set null,
  add column if not exists resolved_work_policy_id uuid references public.work_policies(id) on delete set null,
  add column if not exists policy_source text check(policy_source in ('assignment','employee','site','none')),
  add column if not exists policy_snapshot jsonb;

create or replace view public.employee_onboarding_readiness
with (security_invoker=true) as
select
  profile.id as profile_id,profile.full_name,profile.email,employment.employee_code,employment.employment_status,
  (nullif(trim(profile.full_name),'') is not null) as has_name,
  (employment.profile_id is not null) as has_employment,
  (case when employment.employment_type='monthly' then employment.monthly_salary>0 else employment.daily_rate>0 end) as has_pay_rate,
  (employment.overtime_hourly_rate>0) as has_ot_rate,
  coalesce(assignments.all_sites_have_policy,false) as has_work_policy,
  (coalesce(assignments.site_count,0)>0) as has_site,
  (nullif(trim(profile.full_name),'') is not null and employment.profile_id is not null
    and case when employment.employment_type='monthly' then employment.monthly_salary>0 else employment.daily_rate>0 end
    and coalesce(assignments.all_sites_have_policy,false) and coalesce(assignments.site_count,0)>0) as ready_to_clock,
  member.company_id,coalesce(assignments.site_count,0)::integer as active_site_count,
  case when employment.work_policy_id is not null then 'employee'
    when assignments.has_assignment_policy then 'assignment'
    when assignments.has_site_policy then 'site' else 'none' end as policy_source
from public.company_members member
join public.profiles profile on profile.id=member.profile_id
left join public.employee_employment_records employment on employment.company_id=member.company_id and employment.profile_id=profile.id
left join lateral (
  select count(*) as site_count,
    bool_and(coalesce(site_assignment.work_policy_id,employment.work_policy_id,site.work_policy_id) is not null) as all_sites_have_policy,
    bool_or(site_assignment.work_policy_id is not null) as has_assignment_policy,
    bool_or(site_assignment.work_policy_id is null and site.work_policy_id is not null) as has_site_policy
  from public.employee_site_assignments site_assignment
  join public.project_sites site on site.id=site_assignment.site_id and site.company_id=member.company_id
  where site_assignment.company_id=member.company_id and site_assignment.profile_id=profile.id and site_assignment.active
    and site_assignment.starts_on<=current_date and (site_assignment.ends_on is null or site_assignment.ends_on>=current_date)
) assignments on true
where member.active=true;
grant select on public.employee_onboarding_readiness to authenticated;

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,production_status,current_step,evidence)
values('WORKFORCE-SITE-POLICY-001','ประวัติย้ายไซต์ Multi-site และ Policy Resolution','operations','doing',75,'high',
  'Effective-dated site assignments, assignment/employee/site policy precedence and attendance snapshots.',
  'migration_approved_implementation','migration_and_deploy','Approved by user 12/8/2569; migration prepared with tenant-scoped readiness.')
on conflict(work_key) do update set status='doing',progress=75,detail=excluded.detail,
  production_status=excluded.production_status,current_step=excluded.current_step,evidence=excluded.evidence,updated_at=now();
