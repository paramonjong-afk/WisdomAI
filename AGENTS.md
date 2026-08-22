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
