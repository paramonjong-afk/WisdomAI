begin;

-- Reconcile the authoritative queue with deployment/UAT evidence already
-- recorded in docs/CURRENT_WORK_STATUS.md. Guards prevent overwriting a
-- newer worker lease or a later state transition.
update public.system_work_items
set status = 'review', progress = 90,
    production_status = 'deployed_pending_uat',
    evidence = 'Production source is deployed; Attendance enter/exit, GPS, shared-device and duplicate-clock UAT remains pending.',
    worker_id = null, heartbeat_at = null, lease_expires_at = null,
    current_step = 'uat_pending', updated_at = now()
where work_key = 'TEN-001'
  and status = 'ready'
  and production_status = 'awaiting_approval'
  and worker_id is null;

update public.system_work_items
set status = 'done', progress = 100,
    production_status = case work_key
      when 'TEN-002' then 'deployed_cron_verified'
      when 'TEN-004' then 'deployed_uat_passed'
      when 'TEN-005' then 'deployed_smoke_passed'
      when 'TEN-008' then 'migration_applied_verified'
    end,
    evidence = case work_key
      when 'TEN-002' then 'Migration 202608090011 is present remotely; Vault-backed attendance Cron and unauthorized HTTP 401 were verified; administrator confirmed closure.'
      when 'TEN-004' then 'Migration 202608100002 and create-employee are deployed; anonymous HTTP 401 and real Admin employee-creation UAT passed.'
      when 'TEN-005' then 'Migration 202608100003 and manage-employee v15 are deployed; tenant authorization tests, lint, build and anonymous HTTP 401 smoke passed.'
      when 'TEN-008' then 'Migration 202608100004 is present remotely; tenant RPC and employee tenant regression tests, lint and build passed.'
    end,
    worker_id = null, heartbeat_at = null, lease_expires_at = null,
    current_step = 'completed', updated_at = now()
where work_key in ('TEN-002', 'TEN-004', 'TEN-005', 'TEN-008')
  and status = 'ready'
  and production_status = 'awaiting_approval'
  and worker_id is null;

commit;
