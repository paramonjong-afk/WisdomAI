## Multi-Agent Work Claim Protocol (system_work_items)

This project is worked on by multiple AI agents/tools (Claude Code/Cowork, Codex, the `automation-worker` Edge Function, and others) that do not share memory with each other. `public.system_work_items` -- not `docs/CURRENT_WORK_STATUS.md` -- is the live, authoritative source of truth for "what task is this, and is anyone already on it." Every agent MUST follow this protocol before touching code, and it comes before the Workflow Change Standard below.

1. **Look up the task.** Query the row by `work_key` (create it first if it does not exist yet -- `status='ready'`, plus `title`/`category`/`risk`/`detail` -- before writing any code; do not do undocumented work).
2. **Check for an active claim before starting.**
   - If `worker_id IS NOT NULL` AND `lease_expires_at >= now()`, the task is actively claimed by another agent. Do not start it. Report the conflict (work_key, worker_id, lease_expires_at, current_step) back to the user instead of proceeding.
   - If `worker_id IS NULL`, or `lease_expires_at < now()` (an expired lease is abandoned), the task is free to claim. A stale claim should not be ignored silently -- read `current_step`/`error_fingerprint` first to learn why the previous attempt stopped before restarting the work.
3. **Claim it atomically before writing any code.** Set `worker_id` to a stable identity for this agent/session (e.g. `claude-cowork:<date>`, `codex-cli:<host>`, `local-windows-runner-01`), `lease_expires_at = now() + interval '2 hours'` (or shorter for a small task), `heartbeat_at = now()`, and `current_step` to a short human-readable description of what you're about to do.
4. **Keep the lease alive while working.** Refresh `heartbeat_at` and `lease_expires_at` whenever `current_step` changes, and extend the lease explicitly before it expires if the task is still in progress. Never hold a claim open across a break longer than the lease window.
5. **Release the claim when you stop.** On finishing, blocking, or handing off: update `status`, `progress`, `detail`/`evidence`, and `current_step` to the real state, then clear the claim (`worker_id = NULL`, `lease_expires_at = NULL`) so the row is free for the next agent. This applies even when leaving the task `blocked` -- record the blocker in `current_step`/`error_fingerprint`, but do not leave `worker_id` set once you have stopped actively working, since that would falsely tell other agents the task is still in progress.
6. **`docs/CURRENT_WORK_STATUS.md` stays the human-readable narrative log** -- append a closing entry there when a task reaches `done` or a durable `blocked` state needing a human decision. It is a record synced from `system_work_items`, never the primary source of truth, and must not be relied on to decide whether a task is currently claimed.
7. **Retries are bounded -- do not fight the cap.** `claim_system_work_item` increments `attempt_count` on every claim and refuses to hand out an item once `attempt_count` reaches `max_attempts` (default 5). If a task keeps failing, do not repeatedly reset its `status` back to `ready` by hand -- that defeats the safety net and is exactly the loop this rule exists to prevent. When you hit the cap: fix the actual root cause first, then call `reset_system_work_item_retry(work_key, actor)` (or the `automation-worker` action `reset_retry`) to consciously clear `attempt_count`/`blocked_since` and requeue it. Never call the reset before the root cause is actually fixed.
8. **A `blocked` item may auto-escalate.** Every 30 minutes, `system_work_items` rows that are `blocked` with `attempt_count >= 5` or `blocked_since` older than 2 hours get a Telegram alert to the admin room(s) (health-monitor action `send_work_escalations`). If you see that alert, treat it as "a human decision is needed here," not as "an agent should silently retry."

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

## Automated Supabase Deployment Standard

Supabase Edge Functions and migrations deploy via GitHub Actions (`.github/workflows/deploy-supabase-functions.yml`, `.github/workflows/deploy-supabase-migrations.yml`), not by anyone running the Supabase CLI by hand. Migrations apply to Production automatically on merge to `main` with no manual approval step afterward -- by explicit user decision (2026-09-04) -- so the safety gate must sit *before* merge, never after. Any change to these workflow files, or to what counts as "safe to auto-apply," needs the same rigor as a schema change itself.

1. **Migrations never reach `main` directly.** Open a Pull Request; do not push a new `supabase/migrations/*.sql` file straight to `main`. This is the actual human checkpoint, since nothing gates `main` → Production.
2. **The migrations workflow must verify before it ever touches Production**, on every PR and every push: (a) replay every migration from scratch against a throwaway local Postgres (`supabase start` + `supabase db reset`) so a broken migration fails in CI, not on the live database; (b) scan newly added migration files for destructive statements (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, unwhered `DELETE`/`UPDATE`) and fail unless the commit message explicitly contains `ALLOW-DESTRUCTIVE-MIGRATION`; (c) run `supabase db push --dry-run` and only proceed to a real push after all of the above pass.
3. **Branch protection on `main` must require the migrations-verify check to pass before merge is allowed.** If branch protection is ever disabled or weakened, the auto-apply-on-push behavior becomes unsafe and must be treated as a production incident, not a minor config drift.
4. **This project is on the Supabase Free plan -- there is no point-in-time recovery.** Treat every migration as effectively unrecoverable if it corrupts data; the pre-merge checks in point 2 are the only real safety net, not a database backup. Take a manual `pg_dump` before any migration you are not fully confident about, regardless of CI passing.
5. **Never weaken or bypass these checks to unblock a task.** If a legitimate migration is destructive on purpose, use the explicit override marker in point 2(b) and say so plainly in the PR description -- do not delete or comment out the guard.

6. **Check added and modified migrations using `scripts/migration-safety-guard.mjs`.** Its conservative lexical checks cover multiline statements and routine bodies; dynamic SQL requires explicit review. It is not a substitute for SQL review or runtime verification. `npm run test:migration-safety` must pass before the full replay.
7. **Deploy functions after migrations.** The reusable functions workflow is called only after the same main commit's migration apply succeeds. Do not add an independent push/dispatch deployment path that bypasses this dependency. Keep in-flight migration applies non-cancellable through the release concurrency setting.

## Evidence Drawer Standard

When a Drawer must show an image or PDF, read and follow `docs/EVIDENCE_SPLIT_REVIEW_STANDARD.md`. The default interaction must keep evidence and review controls on the same route through `EvidenceSplitReviewWorkspace`; opening a new browser tab is secondary fallback only. Preserve form state, scope preview state to the active record, discard stale async preview results, use the Module's existing secure signed-reference path, and verify Desktop/Tablet/Mobile behavior.
