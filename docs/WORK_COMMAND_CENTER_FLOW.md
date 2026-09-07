# Work Command Center Flow

```mermaid
flowchart LR
  A[Authenticated user opens /work-command-center] --> B[Load lightweight work-item list]
  B --> C[Filter, sort, paginate in StandardDataTable]
  C --> D[Realtime update or manual refresh]
  D --> B
  C --> E[User clicks a row]
  E --> F[Load full detail/evidence + timeline with request identity]
  F -. stale response or closed Drawer .-> X[Discard stale response]
  F --> G[Drawer displays operational context and actions]
  G --> H[Approval/create mutation through RPC]
  H --> I[Audit/event ledger and refreshed list]
  B -. query error .-> J[Visible error message and retry]
  F -. detail error .-> J
```

## Purpose

The Work Command Center is the authenticated operational queue for creating,
reviewing, approving, and monitoring `system_work_items`. The list view is a
summary projection; full `detail` and `evidence` are fetched only when a user
opens a row so the initial page remains responsive without hiding information.

## Inputs and outputs

- **Inputs:** authenticated company context, `system_work_items`, realtime
  changes, and explicit user actions.
- **List output:** status counts and a paginated table of current work-item
  summaries.
- **Detail output:** full detail/evidence, worker lease state, and the latest
  100 audit events for the selected work key.
- **Mutation output:** RPC result, refreshed list, and audit/event record.

## States, roles, and safety

The table reflects `ready`, `doing`, `review`, `blocked`, and `done`. Company
context and existing RLS/RPC permissions remain authoritative. The UI never
updates `system_work_items` directly; create and approval actions use the
existing RPCs and mutation-attempt audit path.

## Active Claim semantics

```mermaid
flowchart TD
  D[status = doing] --> W{worker_id exists?}
  W -- no --> O[หยุดผิดปกติ: ไม่มี Active Claim]
  W -- yes --> L{lease ยังไม่หมด?}
  L -- no --> S[Worker ขาดการติดต่อ]
  L -- yes --> H{heartbeat สดภายใน 10 นาที?}
  H -- no --> S
  H -- yes --> A[กำลังทำจริง: Active Claim]
```

`กำลังทำจริง` จะแสดงเฉพาะเมื่อมี `worker_id`, `lease_expires_at` ยังไม่หมด
และ `heartbeat_at` สดไม่เกิน 10 นาทีจากเวลาปัจจุบัน การมี `status=doing`
เพียงอย่างเดียวไม่ถือว่าเป็น Active Claim; งานอย่าง `SYS-004` ที่เป็น monitoring
sentinel หรือแถว orphan จะถูกแสดงเป็นหยุดผิดปกติ/ขาดการติดต่อแทน และไม่ถูกนับใน
การ์ด “กำลังทำจริง”.

## Failure, retry, and audit

List/detail query failures stay visible with a retry action. Realtime refreshes
are debounced and repeat the lightweight list query; opening a row performs a
separate full-detail query. Existing event/audit records are not changed or
discarded. The Work Command Center owner is Platform Operations.

Each Drawer open receives a monotonic request identity. Only the latest open
may update detail, evidence, timeline, loading, or error state; responses from
an earlier row or a closed Drawer are discarded. Detail failures are shown
separately from list errors and can be retried without changing the selected
work item. Successful silent list refreshes clear stale list notices.

## Change record

- Version: v1.1
- Date: 2026-09-07
- Rationale: reduce `/work-command-center` LCP by removing large detail/evidence
  fields from the initial list payload while preserving on-demand inspection.
- Migration: none.
- Rollback: revert the UI commit; database records and audit history are
  unaffected.

- Version: v1.2
- Date: 2026-09-07
- Rationale: prevent stale Drawer responses and make detail recovery explicit.
- Migration: none.
- Rollback: revert the UI/test/doc commit; database records and audit history
  are unaffected.

- Version: v1.3
- Date: 2026-09-07
- Rationale: distinguish the persisted `doing` state from a live worker claim so
  stale/orphan rows cannot be presented as actively running.
- Verification: targeted Work Command Center test, typecheck, lint, build and
  read-only query of `worker_id`, `heartbeat_at`, `lease_expires_at` and
  `system_worker_runs`.
- Migration: none. No work item or business data is changed by the UI.
- Rollback: revert the UI/test/doc commit; claim and audit history remain intact.
