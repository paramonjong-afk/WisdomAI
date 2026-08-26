# Codex Account Switch Handoff

Updated: 2026-08-26 (Asia/Bangkok)

## Goal

Change the signed-in Codex/ChatGPT account without losing the authoritative source, current Production state, pending work, safety boundaries, or restart instructions.

## What Moves Safely

- Git commits and remote branches on GitHub.
- Production frontend on Cloudflare.
- Supabase schema and business data already deployed.
- Repository documentation, Flow Registry documents, tests and migration history.

## What Must Not Be Assumed to Move

- Codex task/chat history from the previous account.
- Local browser authentication sessions.
- Local Codex approvals, permissions or usage state.
- Uncommitted files, stashes and worktrees unless the same Notebook/workspace remains available.
- Secrets. They must be re-authorized through the approved secret manager or environment setup, never copied into this document.

## Before Signing Out

1. Confirm this handoff branch is pushed to GitHub.
2. Confirm the URL and commit shown in the final handoff report.
3. Keep `D:\WisdomAI-React` untouched because it contains user-owned changes and worktrees.
4. Record any new user decision made after this document in a new commit or task checkpoint.
5. Do not copy `.env`, tokens, cookies or browser profile files.

## Start on the New Account

Use a new clean directory. Do not reuse or clean the dirty primary workspace.

```powershell
git clone https://github.com/paramonjong-afk/WisdomAI.git WisdomAI-account-resume
cd WisdomAI-account-resume
git fetch origin --prune
git switch main
git pull --ff-only origin main
git status --short
git log -1 --oneline
```

Read the handoff branch without merging it:

```powershell
git fetch origin codex/account-switch-handoff-20260826
git show origin/codex/account-switch-handoff-20260826:CODEX_HANDOFF.md
git show origin/codex/account-switch-handoff-20260826:docs/CODEX_ACCOUNT_SWITCH_HANDOFF.md
```

If the owner decides to continue from the handoff branch:

```powershell
git switch --track origin/codex/account-switch-handoff-20260826
git status --short
```

## Read Order

1. `AGENTS.md`
2. `CODEX_HANDOFF.md`
3. `docs/CODEX_ACCOUNT_SWITCH_HANDOFF.md`
4. `docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md`
5. `docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md`
6. `docs/RELEASE_INCIDENT_PLAYBOOK.md`
7. Flow documents for the Module being changed

## First Read-Only Verification

```powershell
git status --short
git branch --show-current
git log -1 --oneline
git remote -v
git branch -r
git worktree list
git stash list
```

Expected current Production baseline at handoff: `36222b5` on `origin/main`.

If `origin/main` has moved, treat the newer commit as current only after reading its PR/change, CI results, Cloudflare revision and authenticated runtime evidence.

## Current Operational Priority

Do not permanently close employee advances yet. Complete these gates in order:

1. Review five attendance/time records.
2. Resolve three missing exit times.
3. Verify missing/unconfirmed labor evidence of at least THB 2,750.
4. Assign a named Accounting/advance owner.
5. Save reconciliation remarks without changing original OCR/slip evidence.
6. Apply payroll/labor deduction and verify no duplicate expense.
7. Approve settlement and close only after destination acceptance and Audit completeness.

## Optional Branch Recovery

Auto Checkpoint Guard is useful for future account changes but is not merged into current `main`:

```powershell
git fetch origin codex/auto-checkpoint-guard
git show origin/codex/auto-checkpoint-guard:.task-checkpoints/AUTO-CHECKPOINT-GUARD-20260825/handoff.md
```

Because that branch is behind current `main`, review its diff and port it onto a fresh branch rather than merging it directly.

The mobile guide exists only on `origin/codex/restore-mobile-github-guide` at commit `b3121d1`. It is not present on current `main`.

## Release Rule

Use this path only:

`local tests -> clean commit -> GitHub PR/main -> CI -> Cloudflare Git Integration -> release parity -> authenticated smoke -> Audit/destination verification`

Direct Wrangler deployment and local Cloudflare token are emergency fallback only.

## Completion Standard

A resumed task is complete only when the full path is verified:

`source -> validation -> durable write -> state transition -> destination/owner -> visible UI action -> Audit -> retry/recovery -> rollback`

HTTP 200, a successful button click, a build, a push, or a single RPC response is not enough by itself.
