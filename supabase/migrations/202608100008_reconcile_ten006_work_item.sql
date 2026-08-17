begin;

-- TEN-006 was deployed and verified before its authoritative queue row was
-- closed. Only reconcile the exact stale state and never overwrite a lease.
update public.system_work_items
set status = 'done',
    progress = 100,
    production_status = 'database_frontend_deployed_smoke_passed',
    evidence = 'Migration 202608100005 is present remotely; tenant Config regression, lint and build passed; Vercel Production deployment and /login plus /workforce-setup HTTP 200 smoke passed.',
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    current_step = 'completed',
    updated_at = now()
where work_key = 'TEN-006'
  and status = 'ready'
  and production_status = 'awaiting_approval'
  and worker_id is null;

commit;
