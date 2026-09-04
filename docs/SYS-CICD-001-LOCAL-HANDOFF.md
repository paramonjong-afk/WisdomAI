# SYS-CICD-001 local handoff

Date: 2026-09-05
Status: BLOCKED - GitHub Actions Supabase credentials unavailable to dry-run.

- Branch: `codex/supabase-migration-safety-gate`
- Local patch commit: `fc384f0`
- Last confirmed remote head: `fc384f049dc1f192510e9ffc3cbd9f16cca8625a`
- PR: https://github.com/paramonjong-afk/WisdomAI/pull/28 (draft)

## Verified locally

- Legacy identity and reconciliation replay: 14 isolated PostgreSQL scenarios passed.
- Deployment workflow contract tests passed.
- Typecheck, targeted ESLint, build and diff whitespace checks passed.
- CI at e1cd910 passed PostgreSQL runtime, typecheck, lint and build.
- Full replay at e1cd910 passed identity guards, then failed at 202608150016
  because the historical work item was absent. 7b2d023 addresses this case.
- Full replay of 7b2d023 passed reconciliation, failed at vendor trigger before
  allocation table creation (run 33916274015). 4d11a6a fixes attachment order.
- Vendor trigger/table SQL tests and targeted lint passed for 4d11a6a.
- Full replay of 4d11a6a passed vendor attachment, then failed on an absent
  historical salary correction target (run 33916675589). 65b791a guards only
  pristine identity/document/allocation tables; five SQL scenarios and lint pass.
- Runtime/typecheck/lint/build CI passed at 4d11a6a.
- Replay of 65b791a passed salary repair, failed at 20260830101500 view column
  removal (run 33917055323). fc384f0 preserves columns and reviewed-period join.
- Ledger view PostgreSQL replay and targeted lint pass for fc384f0.
- Runtime/typecheck/lint/build CI passed at 65b791a.
- Full migration replay PASSED at fc384f0, run 33917433661.
- Runtime/typecheck/lint/build PASSED at fc384f0, run 33917433674.
- Linked dry-run could not start: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
  and SUPABASE_DB_PASSWORD were all empty in the job environment.
- No Production apply was executed. History parity/baseline review remain pending.

## Verified configuration inventory (2026-09-05)

Inspected through the signed-in GitHub settings UI, without opening secret values:
https://github.com/paramonjong-afk/WisdomAI/settings/secrets/actions

- Repository secrets present: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_PAGES_PROJECT.
- Environment secrets section: no secrets shown.
- Required Supabase Actions secrets absent from that page:
  SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD.
- D:/WisdomAI-React/.env contains populated VITE_SUPABASE_URL and
  VITE_SUPABASE_ANON_KEY. These are frontend settings, not deployment credentials.
- D:/WisdomAI-React/.env.local contains no matching Supabase variable names.
- No matching deployment credentials were present in checked Process/User/Machine
  environment variables or the known workspace/subproject .env locations.
- This is a bounded inventory, not a claim that no copy exists anywhere else.
- Known non-secret project reference: xkieyqixlufjqructjkr.
- Never write secret values, tokens, database passwords or .env contents here,
  in logs, commits or chat. Inspect names/presence only.

## Blocker and next action

The user's PowerShell successfully authenticated and pushed e1cd910. Codex's
CLI session cannot use the stored login; the connector has no write permission.
The user has pushed fc384f0. Configure the three required repository Actions
secrets (or correct their availability), then rerun failed jobs of 33917433661.
Never put credentials in this document or chat.

Then compare local/remote heads, push the task branch without force, and inspect
the complete fresh migration replay and linked dry-run. Do not merge or deploy
until all gates pass and the provisional schema foundation is reviewed.

Read `docs/SUPABASE_REPLAY_FLOW.md` for the narrow identity guard behavior and
remaining baseline/history risks. Do not fabricate identities or suppress
validation errors to make CI pass. No Production migration or deploy was run.

## Remaining review before merge

- Inspect the linked dry-run's exact migration list and remote history parity.
- The backdated profiles/projects foundation is provisional; current local patch
  preserves all existing-table settings. Remote history compatibility still needs review.
- Current local patch replaces the line regex with tested conservative SQL token
  checks and makes function deployment depend on successful migration apply.
- The new local patch requires a fresh CI replay and dry-run before merge.
- Keep PR draft until these issues and dry-run are resolved. No authorization
  to merge this PR or apply Production migrations is inferred from a CI pass.

## Resume from this workspace

Working copy:
C:/Users/jongp/Documents/Codex/2026-08-23/program-general/supabase-migration-safety-gate

Read AGENTS.md, docs/RELEASE_INCIDENT_PLAYBOOK.md and docs/SUPABASE_REPLAY_FLOW.md.
Check the live SYS-CICD-001 claim before edits. Preserve attempt_count and do
not reset the retry cap to hide failures. Preserve unrelated working-tree files.

From the user's authenticated PowerShell, these commands expose no secret values:

```powershell
git -C "C:\Users\jongp\Documents\Codex\2026-08-23\program-general\supabase-migration-safety-gate" status --short --branch
gh secret list --repo paramonjong-afk/WisdomAI
gh run view 33917433661 --repo paramonjong-afk/WisdomAI
```

Only after the required secrets are available, rerun verification:

```powershell
gh run rerun 33917433661 --failed --repo paramonjong-afk/WisdomAI
```

The signed-in Chrome session can read GitHub settings; Codex's shell was unable
to use the user's Windows keyring login. The connector can read CI but write
operations returned 403. Recheck capabilities rather than asking for raw tokens.

Recovery: before merge, use a reviewed revert on the task branch if needed.
No Production rollback is required for this task because nothing was applied.
This handoff is tracked locally; verify it reaches the remote before relying on
it from another machine/account. No unrelated files belong in its commit.

## Latest local completion work (2026-09-05)

- New SQL guard covers added/modified files, multiline DML, nested query WHERE,
  dollar-quoted bodies and explicit review for dynamic SQL. It is conservative,
  not a parser or proof of SQL safety.
- Functions workflow is reusable, called after apply succeeds; function-only
  pushes run verification too. Main releases are serialized without cancellation.
- Foundation existing-table no-op is verified in PostgreSQL.
- Added npm run test:migration-safety to aggregate all replay regressions; CI runs it.
- Local tests, typecheck, full lint, build and git diff --check passed.
- Workflow YAML contract checks pass. Standalone YAML parser packages were not
  available locally; GitHub validation of the new workflow is still required.
- GitHub Secrets were checked again: still only the three Cloudflare entries.
- New scripts/complete-supabase-ci-setup.ps1 is for the user's authenticated
  PowerShell. Syntax was verified; credential writes were not executed by Codex.
  It checks branch/clean tree, preserves existing secret names, prompts through
  GitHub CLI for missing confidential values, sets the known project reference,
  and optionally pushes only the task branch. It never merges or deploys.

One-command user handoff after this local patch is committed:

```powershell
& "C:\Users\jongp\Documents\Codex\2026-08-23\program-general\supabase-migration-safety-gate\scripts\complete-supabase-ci-setup.ps1" -Push
```

The user must supply the Supabase personal access token and database password
at the CLI prompts. Do not substitute frontend anon/service keys or reset a
database password merely to make this setup pass. Then inspect the new PR head,
fresh CI replay and dry-run. Production completion remains blocked until verified.
