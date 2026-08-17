update public.system_work_items
set status = 'ready',
    production_status = 'approved_for_execution',
    current_step = 'approved_for_migration',
    evidence = concat_ws(E'\n', nullif(evidence, ''), '11/8/2569: ผู้ใช้อนุมัติ Migration และดำเนินการ TEN-011 LINE Account Link หลายบริษัทขึ้น Production.'),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'TEN-011'
  and status = 'ready'
  and production_status = 'awaiting_approval';
