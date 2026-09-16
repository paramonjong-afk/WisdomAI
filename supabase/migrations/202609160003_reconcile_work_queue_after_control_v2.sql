-- CTRL-QUEUE-RECONCILE-20260916-V2
-- Reconcile stale implementation/QA children only where the authoritative
-- feature commit is already merged and deployed. No row is deleted.

begin;

with reconciled(work_key, source_ref, resolution) as (
  values
    ('APPROVAL-LOOP-DETECTION-001','PR71 / 237bd282','implemented'),
    ('QA-APPROVAL-LOOP-001','PR71 / 237bd282','superseded_by_merged_qa'),
    ('WCC-ACTIVE-CLAIM-SEMANTICS-001','PR73 / d6ededda','implemented'),
    ('WCC-TIME-CI-COVERAGE-001','PR73 / d6ededda','implemented'),
    ('WCC-TIME-EXPIRY-RECOMPUTE-001','PR73 / d6ededda','implemented'),
    ('QA-WCC-ACTIVE-CLAIM-001','PR73 / d6ededda','superseded_by_merged_qa'),
    ('QA-WCC-TIME-001','PR73 / d6ededda','superseded_by_merged_qa'),
    ('WORKER-PROGRESS-UI-001','PR73 / d6ededda','implemented'),
    ('QA-WORKER-PROGRESS-001','PR73 / d6ededda','superseded_by_merged_qa'),
    ('DOC-INGEST-003','PR75 / 2ea087d5','implemented_custody_scope'),
    ('DOC-INGEST-003-CUSTODY-REMEDIATION-001','PR75 / 2ea087d5','superseded_by_merged_remediation'),
    ('DOC-INGEST-005','PR72 / 91a8dd44','implemented_attachment_dedupe_scope'),
    ('DOC005-HARNESS-CONNECTION-001','PR72 / 91a8dd44','superseded_by_merged_harness'),
    ('DOC005-PR79-INTEGRATE-PR72-001','PR72 / 91a8dd44','superseded_by_final_head'),
    ('DOC005-REAL-RLS-HARNESS-001','PR72 / 91a8dd44','superseded_by_merged_harness'),
    ('DOC005-SAME-COMPANY-DEPARTMENT-DENY-PUBLISH-001','PR72 / 91a8dd44','superseded_by_final_head'),
    ('E1-PR72-ALLOWLIST-DIAG-001','PR72 / 91a8dd44','superseded_by_successful_merge'),
    ('E1-PR72-FIXTURE-BOOTSTRAP-001','PR72 / 91a8dd44','superseded_by_successful_merge'),
    ('QA-DOC005-CONNECTION-RECHECK-001-PROVIDER-PREFLIGHT-001','PR72 / 91a8dd44','superseded_by_merged_qa'),
    ('QA-DOC005-FULL-HARNESS-001','PR72 / 91a8dd44','superseded_by_merged_qa'),
    ('QA-DOC005-SAME-COMPANY-DEPARTMENT-DENY-001','PR72 / 91a8dd44','superseded_by_merged_qa'),
    ('QA-PR72-FIXTURE-DISCOVERY-001','PR72 / 91a8dd44','completed_discovery'),
    ('QA-PR72-HEAD-F10392B-001','PR72 / 91a8dd44','superseded_by_final_head'),
    ('FILTER-001','main / 4067fc9','implemented'),
    ('FILTER-001-RUNTIME-GAP-001','main / 4067fc9','implemented'),
    ('QA-FILTER-RUNTIME-001','main / 4067fc9','superseded_by_merged_qa'),
    ('POSTING-007','PR80 / 6e301b10','implemented'),
    ('POSTING-007-PUBLISH-001','PR80 / 6e301b10','superseded_by_final_head'),
    ('CONTROL-DEPUTY-POSTING007-PUBLISH-DISPATCH-001','PR80 / 6e301b10','superseded_by_successful_merge'),
    ('QA-POSTING-007-EXACT-COMMIT-001','PR80 / 6e301b10','superseded_by_merged_qa'),
    ('QA-POSTING007-PREMERGE-AUTH-SCRATCH-001','PR80 / 6e301b10','superseded_by_successful_merge'),
    ('E1-PR80-CI-INTEGRATION-WIRING-001','PR80 / 6e301b10','superseded_by_final_head'),
    ('E1-PR80-HARNESS-FIXTURE-001','PR80 / 6e301b10','superseded_by_final_head'),
    ('E1-PR80-INDEPENDENT-QA-001','PR80 / 6e301b10','superseded_by_merged_qa'),
    ('E1-PR80-POSTING-RUNTIME-001','PR80 / 6e301b10','superseded_by_merged_runtime'),
    ('E1-PR80-PROVIDER-QA-001','PR80 / 6e301b10','superseded_by_merged_qa'),
    ('E1-PR80-UNAUTHORIZED-HEAD-QA-001','PR80 / 6e301b10','superseded_by_final_head'),
    ('CMD-20260907-000010','PR91 / e9a2afaf','superseded_by_current_approval_flow'),
    ('E1-PR78-RELEASE-001','PR91 / e9a2afaf','superseded_by_current_approval_flow'),
    ('CONTROL-MONITOR-WCC-APPROVAL-P1-001','PR91 / e9a2afaf','superseded_by_production_reconciliation'),
    ('QA-WCC-APPROVAL-BACKLOG-VISIBILITY-P1-001','PR91 / e9a2afaf','superseded_by_production_reconciliation'),
    ('QA-WCC-APPROVAL-BACKLOG-VISIBILITY-P1-REASSIGN-001','PR91 / e9a2afaf','superseded_by_production_reconciliation'),
    ('QA-WCC-APPROVAL-STATE-001','PR91 / e9a2afaf','superseded_by_production_reconciliation'),
    ('E1-PR81-WCC-INTEGRITY-REMEDIATION-001','PR81 / dfe85b5e','superseded_by_final_head'),
    ('QA-WCC-CONTINUOUS-PREMERGE-AUTH-SMOKE-001','PR81 / dfe85b5e','superseded_by_successful_merge'),
    ('WCC-CONTINUOUS-DISPATCH-P1-001-QA-001','PR81 / dfe85b5e','superseded_by_merged_qa'),
    ('WCC-CONTINUOUS-DISPATCH-P1-001-QA-REMAINING-001','PR81 / dfe85b5e','superseded_by_merged_qa'),
    ('WCC-CONTINUOUS-DISPATCH-P1-RELEASE-001','PR81 / dfe85b5e','superseded_by_successful_merge'),
    ('CMD-20260905-000002','CTRL-QUEUE-RECONCILE-20260916-V2','cancelled_incomplete_intake'),
    ('CMD-20260905-000006','PR23 already resolved','cancelled_stale_placeholder'),
    ('CLOUDFLARE-EMERGENCY-SCRIPT-001','RELEASE_INCIDENT_PLAYBOOK v1','superseded_by_git_integration_path')
)
update public.system_work_items item
set status='done', progress=100, control_state='done',
    production_status=case when reconciled.resolution like 'cancelled_%' then 'cancelled_with_audit'
      when reconciled.resolution like 'superseded_%' then 'superseded_with_audit'
      else 'reconciled_production_verified' end,
    current_step='reconciled_by_controller',
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),
      format('CTRL-QUEUE-RECONCILE-20260916-V2: %s; evidence=%s; no history deleted.',reconciled.resolution,reconciled.source_ref)),4000),
    context_manifest=coalesce(item.context_manifest,'{}'::jsonb) || jsonb_build_object(
      'reconciled_by','CTRL-QUEUE-RECONCILE-20260916-V2','resolution',reconciled.resolution,'source_ref',reconciled.source_ref),
    worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
from reconciled
where item.work_key=reconciled.work_key and item.status<>'done' and item.worker_id is null;

-- Pending intents for closed/superseded work must not keep inflating the live
-- dispatch backlog. Intent audit triggers preserve the transition.
with reconciled(work_key) as (
  values
    ('APPROVAL-LOOP-DETECTION-001'),('QA-APPROVAL-LOOP-001'),
    ('WCC-ACTIVE-CLAIM-SEMANTICS-001'),('WCC-TIME-CI-COVERAGE-001'),('WCC-TIME-EXPIRY-RECOMPUTE-001'),
    ('QA-WCC-ACTIVE-CLAIM-001'),('QA-WCC-TIME-001'),('WORKER-PROGRESS-UI-001'),('QA-WORKER-PROGRESS-001'),
    ('DOC-INGEST-003'),('DOC-INGEST-003-CUSTODY-REMEDIATION-001'),('DOC-INGEST-005'),
    ('FILTER-001'),('FILTER-001-RUNTIME-GAP-001'),('QA-FILTER-RUNTIME-001'),
    ('POSTING-007'),('POSTING-007-PUBLISH-001'),('E1-PR80-POSTING-RUNTIME-001'),
    ('CMD-20260905-000002'),('CMD-20260905-000006'),('CLOUDFLARE-EMERGENCY-SCRIPT-001')
)
update public.system_work_dispatch_intents intent set status='completed',updated_at=now()
from reconciled where intent.work_key=reconciled.work_key and intent.status='pending';

-- SYS-004 is a health-monitor sentinel, never a Worker-owned claim. Work
-- Control P0 classified legacy doing/no-lease rows as worker_lost; restore the
-- sentinel-specific semantics without closing its open incidents.
update public.system_work_items
set control_state='active',controller_owner='health-monitor',execution_owner='health-monitor',
    current_step='monitoring_incidents_without_worker_claim',
    evidence=left(concat_ws(E'\n',nullif(evidence,''),
      'CTRL-QUEUE-RECONCILE-20260916-V2: SYS-004 is an active monitoring sentinel; no Worker lease is required. Open incidents remain authoritative.'),4000),
    worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
where work_key='SYS-004' and status='doing' and production_status like 'monitoring_active%';

-- Keep the operational objective open: PR81 shipped durable intents, but the
-- current runtime still reports zero active Worker claims.
update public.system_work_items
set control_state='blocked',production_status='implementation_merged_runner_capacity_pending',
    current_step='dispatch_intents_exist_but_no_active_worker_runner',
    evidence=left(concat_ws(E'\n',nullif(evidence,''),
      'CTRL-QUEUE-RECONCILE-20260916-V2: PR81 implementation is merged; operational closure is blocked because no Worker currently holds a live claim.'),4000),
    updated_at=now()
where work_key='WCC-CONTINUOUS-DISPATCH-P1-001' and status='blocked' and worker_id is null;

commit;

