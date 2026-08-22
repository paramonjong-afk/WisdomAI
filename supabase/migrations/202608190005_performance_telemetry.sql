-- SYS-PERF-001: browser measurements are retained centrally; threshold breaches
-- are deduplicated by register_client_error_event in the System Health register.
alter table public.app_activity_logs drop constraint if exists app_activity_logs_event_type_check;
alter table public.app_activity_logs add constraint app_activity_logs_event_type_check check(event_type in(
  'session_start','session_end','page_view','client_error','request_error','export_data',
  'company_created','company_switched','line_group_company_assigned',
  'line_group_company_assignment_approved','mutation_attempt','performance_metric'
));

create index if not exists app_activity_logs_company_performance_created_idx
  on public.app_activity_logs(company_id,created_at desc)
  where event_type='performance_metric';

update public.system_work_items
set status='review',progress=greatest(progress,60),production_status='source_verified_deploy_pending',
    evidence=coalesce(evidence,'') || ' Source verification 2026-08-19: API latency/result/query length, browser page-load/LCP/interaction, and table row/page size are monitored. health-monitor evaluates API p95, LCP/interaction p95, error rate, URL/query size and queue SLA; incidents open after 2 failing checks, recover after 2 healthy checks, and repeat no sooner than 30 minutes. Focused tests, lint and build passed; migration/deploy/UAT remain pending.',
    updated_at=now()
where work_key='SYS-PERF-001';
