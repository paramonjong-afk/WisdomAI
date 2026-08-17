-- Fix ambiguity between the RETURNS TABLE output variable and line_groups.line_group_id.
create or replace function public.approve_line_group_assignment(
  target_option_id uuid,
  actor_profile_id uuid default auth.uid()
)
returns table(result_status text,line_group_id text,company_id uuid,company_name text)
language plpgsql
security definer
set search_path=public
as $$
declare option_row public.line_group_assignment_options;
declare request_row public.line_group_assignment_requests;
declare actor_is_platform_admin boolean;
begin
  select coalesce(profile.platform_role='admin',false) into actor_is_platform_admin
  from public.profiles as profile where profile.id=actor_profile_id;
  if not actor_is_platform_admin then raise exception 'platform_admin_required'; end if;
  if auth.role()<>'service_role' and actor_profile_id<>auth.uid() then raise exception 'actor_mismatch'; end if;

  select assignment_option.* into option_row
  from public.line_group_assignment_options as assignment_option
  where assignment_option.id=target_option_id and assignment_option.expires_at>now()
  for update;
  if option_row.id is null then raise exception 'assignment_option_not_found_or_expired'; end if;

  select assignment_request.* into request_row
  from public.line_group_assignment_requests as assignment_request
  where assignment_request.id=option_row.request_id
  for update;
  if request_row.id is null then raise exception 'assignment_request_not_found'; end if;
  if request_row.status='assigned' then
    return query
      select 'already_assigned'::text,request_row.line_group_id,request_row.assigned_company_id,company.name
      from public.companies as company where company.id=request_row.assigned_company_id;
    return;
  end if;
  if not exists(
    select 1 from public.companies as company
    where company.id=option_row.company_id and company.active=true
  ) then
    raise exception 'active_company_not_found';
  end if;

  perform set_config('app.platform_company_bootstrap','on',true);
  insert into public.line_groups(company_id,line_group_id,display_name,active,last_event_at,joined_at)
  values(option_row.company_id,request_row.line_group_id,request_row.display_name,true,request_row.last_seen_at,request_row.first_seen_at)
  on conflict on constraint line_groups_line_group_id_key do update set
    display_name=coalesce(excluded.display_name,line_groups.display_name),
    last_event_at=greatest(line_groups.last_event_at,excluded.last_event_at),
    updated_at=now();

  update public.line_group_assignment_requests as assignment_request set
    status='assigned',assigned_company_id=option_row.company_id,assigned_by=actor_profile_id,
    assigned_at=now(),updated_at=now()
  where assignment_request.id=request_row.id and assignment_request.status='pending';

  insert into public.app_activity_logs(profile_id,company_id,event_type,severity,message,metadata)
  select actor_profile_id,option_row.company_id,'line_group_company_assignment_approved','info',
    'Platform Admin assigned a quarantined LINE Group to a company',
    jsonb_build_object('request_id',request_row.id,'line_group_id',request_row.line_group_id,
      'company_id',option_row.company_id,'approved_at',now());
  perform set_config('app.platform_company_bootstrap','off',true);

  return query
    select 'assigned'::text,request_row.line_group_id,option_row.company_id,company.name
    from public.companies as company where company.id=option_row.company_id;
end;
$$;

revoke all on function public.approve_line_group_assignment(uuid,uuid) from public,anon;
grant execute on function public.approve_line_group_assignment(uuid,uuid) to authenticated,service_role;

