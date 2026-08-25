# Master Data Review Step UAT — 25/8/2569

Scope: Local-first verification for `/master-data?local_test_data=1`. This document does not claim that the branch is deployed to Production.

## Dataset and reconciliation

- Dataset: `master-data-project-first-v1`
- Initial queue: 53 pending items
- Existing Project path: fixture candidate 001 linked to `fixture-project-panthong`, correction saved, then explicitly confirmed
- Immediate result: 52 pending, 1 confirmed; the next item opened automatically
- Project Candidate path: fixture candidate 002 saved as `local-project-candidate-fixture-candidate-002` with `awaiting_open_project`, actor, timestamp, Version and Audit event shown in the Drawer
- Missing field path: fixture candidate 003 stayed pending and showed the six missing Project fields inline; its Primary Action remained disabled
- Drawer isolation: candidate 003 showed `fixture-document-003` and `fixture-message-003`; no receipt from candidates 001/002 leaked into the new Drawer

## Action and persistence behavior

- The Drawer shows the five-step path: Project pending, Project ready, corrected, awaiting re-review, confirmed.
- Only one Primary Action is shown for the current stage. Request information, reject, archive, next item and return to queue are grouped under the additional-actions menu.
- Raw/OCR and Source Reference remain read-only.
- Production RPC persistence was tested only inside a forced rollback subtransaction. The probe created Project Candidate, Version and Audit rows, completed correction and approval, then rolled back; probe rows after rollback were zero and Production counts did not change.

## Responsive and runtime checks

- Desktop browser: stepper, Drawer, sticky action area, inline blockers and scrollable fields were visible without overlapping the queue.
- Tablet/mobile behavior is protected by responsive MUI Stack directions, compact Step labels, a full-width single Primary Action and a grouped secondary menu. Static/contract checks verify these responsive declarations because the active in-app Browser session exposes no viewport-emulation capability.
- Current Local server browser console: no warning/error entries for the active Local port.

## Automated gates

- `scripts/master-data-review-step-ux.test.ts`
- `scripts/master-data-project-first-gate.test.ts`
- `scripts/master-data-candidate-review.test.ts`
- TypeScript project build, targeted ESLint, full ESLint and Vite production build

## Release status

The change must remain on `codex/master-data-step-ux` until it is reviewed. It must not be merged to `main` or deployed by this task. Production remains on its existing revision and data remains unchanged.
