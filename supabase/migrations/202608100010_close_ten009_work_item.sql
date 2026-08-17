begin;

-- Storage tenant isolation was already deployed and smoke-tested. The user
-- explicitly accepted closure and deferred the authenticated two-company UAT.
-- Guards prevent overwriting a newer worker lease or state transition.
update public.system_work_items
set status = 'done',
    progress = 100,
    production_status = 'deployed_storage_uat_deferred_by_user',
    evidence = 'Migration 202608100009, tenant-scoped Storage policies, frontend paths and line-webhook are deployed. Storage tenant regression, lint, build, BOQ HTTP 200 and invalid LINE signature HTTP 401 passed. User explicitly deferred authenticated two-company Storage UAT on 10/8/2569.',
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    current_step = 'completed',
    updated_at = now()
where work_key = 'TEN-009'
  and status = 'ready'
  and production_status = 'awaiting_approval'
  and worker_id is null;

commit;
