-- User decision: defer TEN-010 authenticated UAT and continue the multi-company audit.
update public.system_work_items
set status = 'done',
    progress = 100,
    current_step = 'completed_uat_deferred_by_user',
    production_status = 'deployed_uat_deferred_by_user',
    evidence = concat_ws(E'\n', nullif(evidence, ''), '11/8/2569: ผู้ใช้อนุมัติ TEN-010 และสั่งเลื่อน authenticated two-company/Telegram destination UAT ไปตรวจภายหลัง; Migration, Edge Function, Frontend, tenant regression, lint/build และ Production smoke ผ่านแล้ว.'),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'TEN-010'
  and status = 'review';

update public.system_work_items
set status = 'ready',
    progress = greatest(progress, 85),
    current_step = 'approved_dependency_reaudit',
    production_status = 'approved_for_execution',
    evidence = concat_ws(E'\n', nullif(evidence, ''), '11/8/2569: ผู้ใช้อนุมัติ AUD-001 และเลื่อน TEN-010 UAT ไปตรวจภายหลัง; พร้อมตรวจ dependency ที่เหลือ TEN-011/TEN-012 และสรุป Multi-company audit.'),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'AUD-001'
  and status = 'ready'
  and production_status = 'awaiting_approval';
