-- Central policy record for monitoring every web/API module.
insert into public.system_work_items(
  work_key,title,category,status,progress,risk,detail,evidence,production_status
) values (
  'SYS-PERF-001','มาตรฐานวัดความเร็วและแจ้งปัญหาทุก Module','operations','doing',25,'high',
  'System Health ต้องวัด availability, API p95, LCP, interaction latency, error rate, query/page size และ queue SLA; เกินเกณฑ์ต่อเนื่อง 2 รอบให้สร้าง Incident แบบ deduplicate และแจ้งซ้ำทุก 30 นาที',
  'Source evidence 2026-08-19: existing app_activity_logs now records API latency/result/query length, Web Vitals (LCP/interaction), and table row/page size without a schema migration. health-monitor computes p95/error-rate, queue SLA, deduplicates after two failing rounds, resolves after two healthy rounds, and enforces repeat alerts no sooner than 30 minutes. Static source test added; migration/deploy/UAT remain pending.',
  'partially_deployed'
) on conflict(work_key) do update set
  detail=excluded.detail,evidence=excluded.evidence,status='review',progress=greatest(public.system_work_items.progress,excluded.progress,60),risk='high',production_status='source_verified_deploy_pending',updated_at=now();
