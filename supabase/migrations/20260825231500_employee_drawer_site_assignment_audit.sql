-- Employee Drawer uses the canonical site assignment RPC. Harden it with
-- overlapping-duplicate protection and an immutable creation audit event.
create or replace function public.assign_employee_site(
  target_profile_id uuid,target_site_id uuid,target_starts_on date default current_date,
  target_ends_on date default null,target_work_policy_id uuid default null,target_is_primary boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  target_company_id uuid:=public.current_company_id();
  new_assignment_id uuid;
begin
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'manager_permission_required'; end if;
  if target_ends_on is not null and target_ends_on<target_starts_on then raise exception 'invalid_assignment_period'; end if;
  if not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=target_profile_id and active) then raise exception 'employee_not_in_company'; end if;
  if not exists(select 1 from public.project_sites where company_id=target_company_id and id=target_site_id and active) then raise exception 'site_not_in_company'; end if;
  if target_work_policy_id is not null and not exists(select 1 from public.work_policies where company_id=target_company_id and id=target_work_policy_id and active) then raise exception 'policy_not_in_company'; end if;
  if exists(
    select 1 from public.employee_site_assignments assignment
    where assignment.company_id=target_company_id and assignment.profile_id=target_profile_id
      and assignment.site_id=target_site_id and assignment.active and assignment.status='active'
      and (assignment.ends_on is null or assignment.ends_on>=target_starts_on)
      and (target_ends_on is null or assignment.starts_on<=target_ends_on)
  ) then raise exception 'site_assignment_already_active'; end if;

  if target_is_primary then
    update public.employee_site_assignments set ends_on=target_starts_on-1,active=(target_starts_on-1)>=starts_on,
      is_primary=false,updated_at=now()
    where company_id=target_company_id and profile_id=target_profile_id and active and is_primary
      and starts_on<target_starts_on and (ends_on is null or ends_on>=target_starts_on);
  end if;

  insert into public.employee_site_assignments(
    company_id,profile_id,site_id,starts_on,ends_on,active,assigned_by,work_policy_id,is_primary,status
  ) values(
    target_company_id,target_profile_id,target_site_id,target_starts_on,target_ends_on,true,
    auth.uid(),target_work_policy_id,target_is_primary,'active'
  ) returning id into new_assignment_id;

  insert into public.employee_site_assignment_events(
    company_id,assignment_id,event_type,reason,before_data,after_data,acted_by
  )
  select target_company_id,new_assignment_id,'created','มอบหมายไซต์งานให้พนักงาน',null,to_jsonb(assignment),auth.uid()
  from public.employee_site_assignments assignment where assignment.id=new_assignment_id;

  return new_assignment_id;
end;$$;

revoke all on function public.assign_employee_site(uuid,uuid,date,date,uuid,boolean) from public,anon;
grant execute on function public.assign_employee_site(uuid,uuid,date,date,uuid,boolean) to authenticated;

comment on function public.assign_employee_site(uuid,uuid,date,date,uuid,boolean) is
  'Tenant-manager site assignment with company/site/policy validation, overlap idempotency gate and immutable assignment audit.';
