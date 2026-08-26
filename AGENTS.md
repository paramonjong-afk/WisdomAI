# Workflow Change Standard

Before changing any module, identify every affected module and inspect the Flow Registry.

1. If an affected module has no registered flow document, create one before changing code. Every Flow document must begin with a renderable graphic Flowchart (Mermaid) and include plain-language explanation. It must cover inputs, outputs, states, roles/permissions, integrations, failure/retry behavior, audit events, and owner.
2. If a flow exists, read all relevant flow documents before making changes.
3. Update the graphic Flowchart, its explanation, the flow document, and `docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md` whenever behavior, data, routing, permissions, actions, or integration changes. Do not leave a Flow document as text-only.
4. Record the change version, date, rationale, impact, migration, verification, and rollback path.
5. Do not finish a workflow-related task until lint, build, tests, applicable migrations, and the real page have been verified.

## End-to-End Completion Gate

For every change, define and verify the complete operational path before declaring it complete: source/input → validation → data write → state transition → destination queue or responsible role → visible UI/action → audit/retry/recovery. A button working, a single status changing, or a successful API response alone is never completion.

- Inspect affected data already in the system as well as new data. Reconcile or explicitly report legacy records that would remain inconsistent.
- Verify counts, permissions, destination visibility, failure paths, idempotency, and the real user-facing page for the relevant role.
- If any link in the path is blocked, missing, ambiguous, or needs new business authority, proactively provide a blocker report: evidence, root cause, affected records/impact, safe recommendation, and the exact decision or access needed. Do not wait for the user to discover it.
- Every final handoff must state: completed end-to-end scope, verification evidence, known remaining blockers (or “none found”), and a rollback/recovery path.
- Follow the reusable command contract in `docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md` for every implementation request.

The Admin Flow Registry (`/flow-registry`) is the user-facing index. Flow documents are the detailed source of truth.

## Release and Deployment Incident Standard

Every Codex thread that changes or deploys the application must read and follow `docs/RELEASE_INCIDENT_PLAYBOOK.md`.

- Primary Production path: validated clean commit → GitHub `main` → GitHub verification → Cloudflare Git Integration → `release.json` parity → authenticated runtime smoke.
- Cloudflare Git Integration is the only Production deployment path. Never upload a locally built `dist`; restore service by fixing Git Integration or rolling back to a successful Git-built deployment.
- If the shared workspace is dirty, preserve all existing changes and release from an isolated clean clone/worktree based on the latest GitHub `main`.
- Do not declare deploy complete from a push, CI success, HTTP 200, or build alone. Record the live URL/revision and verify the changed page plus its destination/Intake/Audit path with the relevant authenticated role.
- Every release handoff must include commit, workflow status, Production revision, test/build evidence, remaining blocker (or “none found”), and rollback/recovery instructions.

## Evidence Drawer Standard

When a Drawer must show an image or PDF, read and follow `docs/EVIDENCE_SPLIT_REVIEW_STANDARD.md`. The default interaction must keep evidence and review controls on the same route through `EvidenceSplitReviewWorkspace`; opening a new browser tab is secondary fallback only. Preserve form state, scope preview state to the active record, discard stale async preview results, use the Module's existing secure signed-reference path, and verify Desktop/Tablet/Mobile behavior.
