-- Explicit administrator instruction: force-close SYS-004 without deleting incidents.
-- A later health run may reopen the work item if an unresolved error still exists.
update public.system_work_items
set status='done',
    progress=100,
    current_step='force_closed_by_admin',
    production_status='force_closed_by_admin_pending_follow_up',
    evidence='Force-closed by explicit system administrator instruction. Source incidents and audit history were retained; monitoring may reopen SYS-004 if an error is detected again.',
    error_fingerprint=null,
    worker_id=null,
    heartbeat_at=null,
    lease_expires_at=null,
    updated_at=now()
where work_key='SYS-004';

update public.system_worker_runs
set status='failed',
    current_step='force_closed_by_admin',
    finished_at=now(),
    heartbeat_at=now()
where work_key='SYS-004' and status='running';
