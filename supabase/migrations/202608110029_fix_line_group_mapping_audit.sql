-- TEN-011 follow-up: allow the approved mapping audit event and keep the
-- tightly-scoped Platform Admin bootstrap flag active through the audit insert.

alter table public.app_activity_logs drop constraint if exists app_activity_logs_event_type_check;
alter table public.app_activity_logs add constraint app_activity_logs_event_type_check check(event_type in(
  'session_start','session_end','page_view','client_error','request_error','export_data',
  'company_created','company_switched','line_group_company_assigned'
));

create or replace function public.assign_line_group_company(
  target_line_group_id text,
  target_company_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare source_company_id uuid;
declare source_project_id uuid;
declare target_company_name text;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin permission required';
  end if;
  if nullif(trim(target_line_group_id),'') is null or target_company_id is null then
    raise exception 'LINE Group and company are required';
  end if;

  select company.name into target_company_name
  from public.companies company
  where company.id=target_company_id and company.active=true;
  if target_company_name is null then raise exception 'Active company not found'; end if;

  select line_group.company_id,line_group.project_id
  into source_company_id,source_project_id
  from public.line_groups line_group
  where line_group.line_group_id=trim(target_line_group_id)
  for update;
  if source_company_id is null then raise exception 'LINE Group not found'; end if;
  if source_company_id=target_company_id then return; end if;

  update public.health_monitor_settings set line_group_id=null,updated_at=now()
    where company_id=source_company_id and line_group_id=trim(target_line_group_id);
  update public.workforce_rule_settings set line_group_id=null,updated_at=now()
    where company_id=source_company_id and line_group_id=trim(target_line_group_id);
  update public.project_sites set line_group_id=null,updated_at=now()
    where company_id=source_company_id and line_group_id=trim(target_line_group_id);

  perform set_config('app.platform_company_bootstrap','on',true);
  update public.line_groups
    set company_id=target_company_id,project_id=null,updated_at=now()
    where line_group_id=trim(target_line_group_id);

  insert into public.app_activity_logs(profile_id,company_id,event_type,severity,message,metadata)
  values(auth.uid(),target_company_id,'line_group_company_assigned','warning',
    'Platform Admin changed LINE Group company ownership',
    jsonb_build_object(
      'line_group_id',trim(target_line_group_id),
      'source_company_id',source_company_id,
      'target_company_id',target_company_id,
      'cleared_project_id',source_project_id,
      'target_company_name',target_company_name,
      'effective_at',now()
    ));
  perform set_config('app.platform_company_bootstrap','off',true);
end;
$$;

revoke all on function public.assign_line_group_company(text,uuid) from public,anon;
grant execute on function public.assign_line_group_company(text,uuid) to authenticated;

update public.system_work_items set
  status='doing',progress=98,current_step='line_group_mapping_audit_repair',
  evidence='Migration 202608110029 permits the dedicated mapping audit event and retains the Platform Admin bootstrap flag only through the ownership update and audit insert.',
  production_status='audit_repair_ready_for_production',updated_at=now()
where work_key='TEN-011';
