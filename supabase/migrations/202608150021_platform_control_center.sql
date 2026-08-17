-- PLATFORM-CONTROL-CENTER-001
-- Prepared only. Do not apply to Production without a separate approval.

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
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform Admin permission required';
  end if;
  since_at:=case target_window when '7d' then now()-interval '7 days' when '30d' then now()-interval '30 days' else now()-interval '24 hours' end;

  select jsonb_build_object(
    'generated_at',now(),
    'kpis',jsonb_build_object(
      'companies',(select count(*) from public.companies),
      'active_companies',(select count(*) from public.companies where active),
      'users',(select count(*) from public.profiles),
      'employees',(select count(distinct profile_id) from public.employee_employment_records where employment_status in ('preboarding','probation','active','notice')),
      'projects',(select count(*) from public.projects where status='active'),
      'sites',(select count(*) from public.project_sites where active),
      'line_groups',(select count(*) from public.line_groups where active),
      'telegram_chats',(select count(*) from public.telegram_admin_chats where active),
      'open_errors',(select count(*) from public.system_error_events where status in ('open','monitoring')),
      'errors_24h',(select count(*) from public.system_error_events where last_seen_at>=now()-interval '24 hours'),
      'pending_work',(select count(*) from public.system_work_items where status in ('ready','doing','blocked')),
      'review_work',(select count(*) from public.system_work_items where status='review'),
      'running_workers',(select count(*) from public.system_worker_runs where status='running' and heartbeat_at>=now()-interval '15 minutes'),
      'avg_latency_ms',(select coalesce(round(avg(latency_ms)),0) from public.health_monitor_checks where latency_ms is not null),
      'p95_latency_ms',(select coalesce(percentile_disc(.95) within group(order by latency_ms),0) from public.health_monitor_checks where latency_ms is not null)
    ),
    'health',coalesce((select jsonb_agg(jsonb_build_object('name',name_th,'module',module,'status',status,'latency_ms',latency_ms,'message',message) order by module) from public.health_monitor_checks),'[]'::jsonb),
    'trend',coalesce((select jsonb_agg(item order by bucket) from (select started_at as bucket,jsonb_build_object('bucket',started_at,'healthy',healthy_count,'warning',warning_count,'critical',critical_count) item from public.health_monitor_runs where started_at>=since_at order by started_at desc limit 24) runs),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object(
      'id',company.id,'name',company.name,'slug',company.slug,'active',company.active,
      'members',(select count(*) from public.company_members member where member.company_id=company.id and member.active),
      'projects',(select count(*) from public.projects project where project.company_id=company.id and project.status='active'),
      'sites',(select count(*) from public.project_sites site where site.company_id=company.id and site.active),
      'line_groups',(select count(*) from public.line_groups line_group where line_group.company_id=company.id and line_group.active),
      'open_errors',(select count(*) from public.system_error_events event where event.company_id=company.id and event.status in ('open','monitoring'))
    ) order by company.active desc,company.name) from public.companies company),'[]'::jsonb),
    'work_items',coalesce((select jsonb_agg(to_jsonb(item) order by item.updated_at desc) from (select work_key,title,status,progress,risk,current_step,updated_at from public.system_work_items where status<>'done' order by updated_at desc limit 20) item),'[]'::jsonb),
    'errors',coalesce((select jsonb_agg(to_jsonb(event) order by event.last_seen_at desc) from (select id,title,affected_module,severity,status,occurrence_count,last_seen_at from public.system_error_events where status in ('open','monitoring') order by last_seen_at desc limit 20) event),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('event',event_type,'reference',work_key,'at',created_at) order by created_at desc) from (select event_type,work_key,created_at from public.system_work_item_events order by created_at desc limit 30) event),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_platform_control_center_snapshot(text) from public,anon;
grant execute on function public.get_platform_control_center_snapshot(text) to authenticated;
comment on function public.get_platform_control_center_snapshot(text) is 'Platform Admin-only aggregate; independent of current_company_id and excludes secrets.';

insert into public.system_work_items(work_key,company_id,scope,title,category,status,progress,risk,detail,production_status,current_step,evidence)
values(
  'PLATFORM-CONTROL-CENTER-001',null,'platform','ศูนย์จัดการระบบกลางสำหรับ Platform Admin','operations','review',90,'high',
  'หน้า Platform Mode แบบกราฟิก รวม KPI, Service Health, Error, งานค้าง, Tenant Tree และ Audit โดยไม่อิงบริษัทที่เลือก',
  'migration_prepared_not_applied','awaiting_migration_review_and_separate_production_approval',
  'Source, route, Platform Admin guard, dashboard and migration prepared. Production apply/deploy intentionally not performed.'
)
on conflict(work_key) do update set
  scope='platform',company_id=null,title=excluded.title,category=excluded.category,status='review',progress=90,risk='high',
  detail=excluded.detail,production_status=excluded.production_status,current_step=excluded.current_step,evidence=excluded.evidence,updated_at=now();
