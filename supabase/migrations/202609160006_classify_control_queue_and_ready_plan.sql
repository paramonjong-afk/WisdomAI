-- Controller queue plan only: never approve, claim, retry, cancel or delete work.
with classified(work_key,management_lane,next_management_action) as (
  values
    ('CMD-20260906-000007','evidence_reconcile','Verify current main evidence; close or re-scope the copy/refresh change.'),
    ('CMD-20260906-000008','evidence_reconcile','Compare current Telegram approval runtime and merge duplicate test evidence.'),
    ('CMD-20260907-000011','technical_execution','Re-run current lint and targeted Telegram guard tests in a clean worktree.'),
    ('CMD-20260907-TARGETED-TEST','evidence_reconcile','Reconcile as a child of CMD-20260906-000008; do not ship a second implementation.'),
    ('CONTROL-DEPUTY-DOC013-GIT-PERMISSION-001','evidence_reconcile','Reconcile against the current DOC-INGEST-013 gateway contract.'),
    ('CTRL-2026-09-09-A','evidence_reconcile','Split the historical release bundle into current authoritative work keys.'),
    ('CTRL-2026-09-09-E1','evidence_reconcile','Split the historical release bundle into current authoritative work keys.'),
    ('DOC-INGEST-002','technical_execution','Review Document Intake Flow before image-quality implementation.'),
    ('DOC-INGEST-006','technical_execution','Review multi-page grouping and legacy records before implementation.'),
    ('DOC-INGEST-007','technical_execution','Re-run the approved file-format scope from a clean Worker checkout.'),
    ('DOC-INGEST-009','technical_execution','Reconcile stale claim, then verify Storage/database consistency read-only.'),
    ('DOC-INGEST-010','technical_execution','Resume OCR confidence metadata from current Flow.'),
    ('DOC-INGEST-011','authority_or_access','Provide backup destination, credential, retention policy and drill owner.'),
    ('DOC-INGEST-012','technical_execution','Review local-first AI Router scope and parser support.'),
    ('DOC-INGEST-013','authority_or_access','Approve exact gateway-executor contract on POSTING-007.'),
    ('DOC-INGEST-014','technical_execution','Review evidence retention before PDF optimization.'),
    ('E1-PR72-APPROVED-MERGE-001','authority_or_access','Provide independent cross-tenant and wrong-department QA sessions.'),
    ('FILTER-003','technical_execution','Map verified commit to current main and rerun reconciliation evidence.'),
    ('FILTER-005','technical_execution','Review new Filter Flow before multidimensional view implementation.'),
    ('FILTER-006','technical_execution','Reconcile stale claim and verify Human Review against current Flow.'),
    ('POSTING-006','technical_execution','Hold until Posting Core phases 1 and 2 define the PO gateway contract.'),
    ('POSTING-009','technical_execution','Hold until Posting Core defines canonical audit and reversal events.'),
    ('POSTING-010','technical_execution','Hold until Posting Core states and SLA dimensions are authoritative.'),
    ('QA-DOC013-PREMERGE-AUTH-SMOKE-001','evidence_reconcile','Reconcile into current DOC-INGEST-013 authenticated gateway QA.'),
    ('QA-POSTING-003-GATE-AUDIT-001','technical_execution','Repeat read-only gate audit against current runtime policy.'),
    ('REMOTE-CROSS-ROOM-CONTEXT-001','authority_or_access','Complete authenticated mobile MCP receipt/approval/result round-trip.'),
    ('SYS-DATA-ACCESS-001','evidence_reconcile','Run remaining authenticated pagination/isolation smoke.'),
    ('SYS-PERF-001','evidence_reconcile','Reconcile obsolete Vercel blocker against canonical Cloudflare path.'),
    ('SYS-PERF-002-DRAWER','evidence_reconcile','Reconcile stale claim and current Drawer regression evidence.'),
    ('WCC-CONTINUOUS-DISPATCH-P1-001','authority_or_access','Treat zero active as capacity loss only with an approved dispatch intent.')
)
update public.system_work_items item
set context_manifest=coalesce(item.context_manifest,'{}'::jsonb)||jsonb_build_object(
      'controller_plan','CTRL-CONTROL-QUEUE-20260916','management_lane',classified.management_lane,
      'next_management_action',classified.next_management_action,'classified_at','2026-09-16T00:00:00+07:00'),
    updated_at=now()
from classified
where item.work_key=classified.work_key and item.status='blocked' and item.worker_id is null;

with planned(work_key,phase,depends_on,next_action) as (
  values
    ('POSTING-FLOW-001',1,'[]'::jsonb,'Approve and define the canonical Posting approval/transaction contract.'),
    ('POSTING-001',2,'["POSTING-FLOW-001"]'::jsonb,'Define approval snapshot and transaction preview.'),
    ('POSTING-002',2,'["POSTING-FLOW-001"]'::jsonb,'Define role, amount and approval-order policy matrix.'),
    ('POSTING-004',3,'["POSTING-FLOW-001","POSTING-001","POSTING-002"]'::jsonb,'Define the Accounting/AP gateway command.'),
    ('POSTING-005',3,'["POSTING-FLOW-001","POSTING-001","POSTING-002"]'::jsonb,'Define the Stock gateway command.'),
    ('POSTING-008',4,'["POSTING-001","POSTING-002","POSTING-004","POSTING-005"]'::jsonb,'Define correction, compensation and reversal matrix.'),
    ('FILTER-004',5,'["POSTING-FLOW-001"]'::jsonb,'Define matching ledger and duplicate decision states.'),
    ('FILTER-007',5,'["POSTING-001","POSTING-002"]'::jsonb,'Build Approval UX after snapshot/concurrency rules.'),
    ('FILTER-008',5,'["POSTING-004","POSTING-005","POSTING-008"]'::jsonb,'Integrate commands, audit and monitoring after gateway/reversal contracts.')
)
update public.system_work_items item
set context_manifest=coalesce(item.context_manifest,'{}'::jsonb)||jsonb_build_object(
      'controller_plan','CTRL-READY-SEQUENCE-20260916','execution_phase',planned.phase,
      'depends_on',planned.depends_on,'approval_gate','explicit_policy_approval_required',
      'next_management_action',planned.next_action),
    current_step=planned.next_action,updated_at=now()
from planned
where item.work_key=planned.work_key and item.status='ready'
  and item.approval_status='pending' and item.worker_id is null;
