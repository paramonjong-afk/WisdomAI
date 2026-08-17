-- PLATFORM-CONTROL-CENTER-001 completion.
-- Prepared after user approval to continue. Apply to Production only through the approval gate.

create or replace function public.get_platform_control_center_snapshot(target_window text default '24h')
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  result jsonb;
  since_at timestamptz;
  bucket_unit text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform Admin permission required';
  end if;
  if target_window not in ('24h','7d','30d') then
    raise exception 'Unsupported dashboard window';
  end if;
  since_at:=case target_window when '7d' then now()-interval '7 days' when '30d' then now()-interval '30 days' else now()-interval '24 hours' end;
  bucket_unit:=case when target_window='24h' then 'hour' else 'day' end;

  select jsonb_build_object(
    'generated_at',now(),'window',target_window,'window_started_at',since_at,
    'kpis',jsonb_build_object(
      'companies',(select count(*) from public.companies),
      'active_companies',(select count(*) from public.companies where active),
      'users',(select count(*) from public.profiles),
      'employees',(select count(distinct (company_id,profile_id)) from public.employee_employment_records where employment_status in ('preboarding','probation','active','notice')),
      'projects',(select count(*) from public.projects where status='active'),
      'sites',(select count(*) from public.project_sites where active),
      'line_groups',(select count(*) from public.line_groups where active),
      'telegram_chats',(select count(*) from public.telegram_admin_chats where active),
      'open_errors',(select count(*) from public.system_error_events where status in ('open','monitoring')),
      'errors_in_window',(select count(*) from public.system_error_events where last_seen_at>=since_at),
      'pending_work',(select count(*) from public.system_work_items where status in ('ready','doing','blocked')),
      'review_work',(select count(*) from public.system_work_items where status='review'),
      'running_workers',(select count(*) from public.system_worker_runs where status='running' and heartbeat_at>=now()-interval '15 minutes'),
      'avg_latency_ms',(select coalesce(round(avg(latency_ms)),0) from public.health_monitor_checks where latency_ms is not null and last_checked_at>=since_at),
      'p95_latency_ms',(select coalesce(percentile_disc(.95) within group(order by latency_ms),0) from public.health_monitor_checks where latency_ms is not null and last_checked_at>=since_at),
      'ready_employees',(select count(*) from public.employee_onboarding_readiness where ready_to_clock),
      'unready_employees',(select count(*) from public.employee_onboarding_readiness where not ready_to_clock),
      'login_failures',(select count(*) from public.app_activity_logs where event_type='request_error' and page_path ilike '%login%' and created_at>=since_at)
    ),
    'health',coalesce((select jsonb_agg(to_jsonb(service) order by service.module) from (
      select module,max(name_th) name,
        case max(case status when 'critical' then 3 when 'warning' then 2 when 'unknown' then 1 else 0 end)
          when 3 then 'critical' when 2 then 'warning' when 1 then 'unknown' else 'healthy' end status,
        round(avg(latency_ms)) latency_ms,max(last_checked_at) checked_at,count(distinct company_id) tenant_count,
        string_agg(distinct coalesce(message,'ไม่มีรายละเอียด'),' · ') message
      from public.health_monitor_checks group by module
    ) service),'[]'::jsonb),
    'trend',coalesce((select jsonb_agg(to_jsonb(point) order by point.bucket) from (
      select date_trunc(bucket_unit,started_at) bucket,
        sum(healthy_count) healthy,sum(warning_count) warning,sum(critical_count) critical,
        count(*) runs
      from public.health_monitor_runs where started_at>=since_at
      group by date_trunc(bucket_unit,started_at) order by bucket desc limit 30
    ) point),'[]'::jsonb),
    'top_slow',coalesce((select jsonb_agg(to_jsonb(item) order by item.latency_ms desc) from (
      select module,name_th name,latency_ms,last_checked_at checked_at,company_id
      from public.health_monitor_checks where latency_ms is not null and last_checked_at>=since_at
      order by latency_ms desc limit 10
    ) item),'[]'::jsonb),
    'error_summary',jsonb_build_object(
      'open',(select count(*) from public.system_error_events where status='open'),
      'monitoring',(select count(*) from public.system_error_events where status='monitoring'),
      'resolved',(select count(*) from public.system_error_events where status='resolved' and updated_at>=since_at),
      'critical',(select count(*) from public.system_error_events where status in ('open','monitoring') and severity='critical'),
      'system_occurrences',(select coalesce(sum(system_occurrence_count),0) from public.system_error_events where last_seen_at>=since_at),
      'user_reports',(select coalesce(sum(user_report_count),0) from public.system_error_events where last_seen_at>=since_at)
    ),
    'communication',jsonb_build_object(
      'line_messages',(select count(*) from public.line_messages where occurred_at>=since_at),
      'line_redeliveries',(select count(*) from public.line_messages where occurred_at>=since_at and is_redelivery),
      'line_quiet_24h',(select count(*) from public.line_groups where active and coalesce(last_event_at,joined_at,created_at)<now()-interval '24 hours'),
      'line_quiet_72h',(select count(*) from public.line_groups where active and coalesce(last_event_at,joined_at,created_at)<now()-interval '72 hours'),
      'telegram_processed',(select count(*) from public.telegram_admin_events where created_at>=since_at and status='processed'),
      'telegram_failed',(select count(*) from public.telegram_admin_events where created_at>=since_at and status='failed')
    ),
    'workforce',jsonb_build_object(
      'ready',(select count(*) from public.employee_onboarding_readiness where ready_to_clock),
      'missing_name',(select count(*) from public.employee_onboarding_readiness where not has_name),
      'missing_employment',(select count(*) from public.employee_onboarding_readiness where not has_employment),
      'missing_pay_rate',(select count(*) from public.employee_onboarding_readiness where not has_pay_rate),
      'missing_policy',(select count(*) from public.employee_onboarding_readiness where not has_work_policy),
      'missing_site',(select count(*) from public.employee_onboarding_readiness where not has_site),
      'multi_site',(select count(*) from (select company_id,profile_id from public.employee_site_assignments where active group by company_id,profile_id having count(*)>1) multi),
      'attendance_review',(select count(*) from public.attendance_sessions where status='needs_review' and clock_in_at>=since_at),
      'wage_overrides',(select count(*) from public.employee_wage_day_overrides where updated_at>=since_at)
    ),
    'companies',coalesce((select jsonb_agg(jsonb_build_object(
      'id',company.id,'name',company.name,'slug',company.slug,'active',company.active,
      'members',(select count(*) from public.company_members member where member.company_id=company.id and member.active),
      'projects',(select count(*) from public.projects project where project.company_id=company.id and project.status='active'),
      'sites',(select count(*) from public.project_sites site where site.company_id=company.id and site.active),
      'employees',(select count(*) from public.employee_employment_records employee where employee.company_id=company.id and employee.employment_status in ('preboarding','probation','active','notice')),
      'unready',(select count(*) from public.employee_onboarding_readiness readiness where readiness.company_id=company.id and not readiness.ready_to_clock),
      'line_groups',(select count(*) from public.line_groups line_group where line_group.company_id=company.id and line_group.active),
      'open_errors',(select count(*) from public.system_error_events event where event.company_id=company.id and event.status in ('open','monitoring')),
      'children',coalesce((select jsonb_agg(jsonb_build_object(
        'id',project.id,'name',project.name,'code',project.code,'status',project.status,
        'sites',coalesce((select jsonb_agg(jsonb_build_object(
          'id',site.id,'name',site.name,'active',site.active,
          'employees',(select count(*) from public.employee_site_assignments assignment where assignment.company_id=company.id and assignment.site_id=site.id and assignment.active)
        ) order by site.name) from public.project_sites site where site.company_id=company.id and site.project_id=project.id),'[]'::jsonb)
      ) order by project.name) from public.projects project where project.company_id=company.id),'[]'::jsonb)
    ) order by company.active desc,company.name) from public.companies company),'[]'::jsonb),
    'work_items',coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc) from (
      select work_key,title,status,progress,risk,current_step,production_status,approval_status,updated_at
      from public.system_work_items where status<>'done' order by updated_at desc limit 50
    ) item),'[]'::jsonb),
    'errors',coalesce((select jsonb_agg(to_jsonb(event) order by event.last_seen_at desc) from (
      select id,company_id,fingerprint,title,affected_module,severity,status,occurrence_count,system_occurrence_count,user_report_count,confirmed_by_user_at,last_seen_at
      from public.system_error_events where status in ('open','monitoring') or last_seen_at>=since_at order by last_seen_at desc limit 50
    ) event),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(event) order by event.at desc) from (
      select 'work_item' source,event_type event,work_key reference,created_at at,null::uuid company_id from public.system_work_item_events
      union all
      select 'wage_override',action,profile_id::text,created_at,company_id from public.employee_wage_day_override_audits
      union all
      select 'app',event_type,coalesce(page_path,profile_id::text),created_at,company_id from public.app_activity_logs
      order by at desc limit 60
    ) event),'[]'::jsonb),
    'metric_definitions',jsonb_build_array(
      jsonb_build_object('key','latency','label','Response time','definition','Average and P95 of current service checks whose last_checked_at falls inside the selected window.'),
      jsonb_build_object('key','errors','label','Error','definition','Fingerprint-deduplicated central system_error_events; occurrences are shown separately.'),
      jsonb_build_object('key','workforce','label','Workforce readiness','definition','Active company members that satisfy name, employment, pay rate, work policy and site requirements.')
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_platform_control_center_snapshot(text) from public,anon;
grant execute on function public.get_platform_control_center_snapshot(text) to authenticated;
comment on function public.get_platform_control_center_snapshot(text) is 'Platform Admin-only aggregate dashboard snapshot, independent of selected tenant and free of secrets.';

update public.system_work_items set
  status='review',progress=85,risk='high',worker_id=null,heartbeat_at=null,lease_expires_at=null,
  current_step='completion_migration_applied_waiting_web_deploy_and_authenticated_smoke',
  production_status='completion_migration_applied_web_deploy_pending',
  evidence='Gap audit completed. Company selector entry, time-window metrics, reconciled service health, drill-down data, tenant tree, error/communication/workforce/audit summaries and regression tests prepared.',
  updated_at=now()
where work_key='PLATFORM-CONTROL-CENTER-001' and scope='platform';
