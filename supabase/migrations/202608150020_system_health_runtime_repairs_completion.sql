-- SYS-004: reconcile the authoritative work item after the approved runtime
-- repairs, Production deployment, authenticated UAT, and incident resolution.
-- This updates the existing platform-scoped row only. It does not create a
-- duplicate work item or modify tenant-owned business data.

update public.system_work_items
set status = 'done',
    progress = 100,
    detail = 'Completed: central error intake, fingerprint deduplication, audited resolution, tenant-safe communication feed, and image optimizer runtime repairs are operational.',
    current_step = 'completed',
    production_status = 'deployed_runtime_uat_passed',
    evidence = concat_ws(
      E'\n',
      nullif(evidence, ''),
      'Migration 202608150019, Web, and image-storage-optimizer version 4 are on Production. Authenticated UAT showed 1,187 images processed, 0 pending, 0 failed, and 77.9 MB saved; no new HTTP 546, optimizer network, communication feed HTTP 500, or native prompt errors were observed. Four historical incidents were resolved individually with Admin audit reasons. A subsequent health run reported 0 open central errors and 0 pending problem-register items.',
      'Source verification refreshed 2026-08-16: test:error-fingerprint, test:system-error-intake, test:problem-register, test:communication-event-feed, test:work-item-reconciliation, test:health-monitor-tenant, test:line-account-tenant, test:workforce-readiness-health, and test:line-webhook-intake passed; npm.cmd run build passed. Full lint is blocked by unrelated user-owned AccountingDocuments work: react-hooks/set-state-in-effect at line 427 and no-constant-binary-expression at line 956 (fingerprint verification:unrelated-accountingdocuments-react-hooks-and-constant-expression). That work was preserved. No migration or deployment was run during this verification.'
    ),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'SYS-004'
  and scope = 'platform'
  and (
    (status = 'doing' and progress = 90)
    or (status = 'done' and progress = 100)
  );

do $$
begin
  if not exists (
    select 1
    from public.system_work_items
    where work_key = 'SYS-004'
      and scope = 'platform'
      and status = 'done'
      and progress = 100
      and production_status = 'deployed_runtime_uat_passed'
  ) then
    raise exception 'SYS-004 completion reconciliation failed';
  end if;
end
$$;
