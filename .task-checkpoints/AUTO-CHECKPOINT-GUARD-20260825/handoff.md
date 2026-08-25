# Task Handoff: AUTO-CHECKPOINT-GUARD-20260825

| Field | Value |
| --- | --- |
| Title | Auto Checkpoint Guard |
| Module | platform-release |
| Owner room | program-general |
| Status | checkpointed |
| Branch | `codex/auto-checkpoint-guard` |
| Base commit | `aba6406d23ae431bfd7d3b3969784b6de2816e45` |
| Checkpoint commit | `1aa85ff4915648b08f16f781bf0d1def19608ece` |
| Remote | `origin` |
| Updated | 2026-08-25T11:35:35.653Z |
| Actor | codex-program-general |

## Objective

Preserve source and handoff context safely across usage limits, compaction, tool instability, and Codex account changes.

## Done

- Inspected repository policies, release conventions, Flow Registry, and dirty workspace.
- Implemented CLI, policy, Flow documentation, example, and Git contract tests.
- Contract tests passed for protected branch, explicit paths, unrelated files, no-op, failed test/push, and cross-worktree resume.
- Targeted lint and typecheck passed before the self-hosted checkpoint.
- All configured gates passed and local checkpoint commits a1bcbb9/cef8504 were created.

## Pending

- Run the configured checkpoint gates and push the work branch.
- Run all configured gates and push the dedicated branch.
- Authenticate GitHub for this shell and rerun checkpoint to persist the blocked record and push the branch.

## Blocker

none

## Next Action

Authenticate GitHub for this shell, then run npm run checkpoint:checkpoint -- --task-id AUTO-CHECKPOINT-GUARD-20260825 and verify origin/codex/auto-checkpoint-guard.

## Tests

| Command | Result | Ran at | Exit code |
| --- | --- | --- | --- |
| `npm run test:auto-checkpoint` | passed | 2026-08-25T11:33:55.142Z | 0 |
| `npx eslint scripts/task-checkpoint-guard.ts scripts/task-checkpoint-guard.test.ts --no-warn-ignored` | passed | 2026-08-25T11:34:02.550Z | 0 |
| `npm run typecheck` | passed | 2026-08-25T11:34:41.437Z | 0 |
| `npm run build` | passed | 2026-08-25T11:35:33.347Z | 0 |

## Owned Paths

- `.task-checkpoints/AUTO-CHECKPOINT-GUARD-20260825/**`
- `AGENTS.md`
- `docs/AUTO_CHECKPOINT_GUARD_FLOW.md`
- `docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md`
- `docs/examples/auto-checkpoint/intake-project-first.manifest.json`
- `package.json`
- `scripts/task-checkpoint-guard.test.ts`
- `scripts/task-checkpoint-guard.ts`

## Resume From Another Account or Worktree

```powershell
git fetch origin codex/auto-checkpoint-guard
git switch codex/auto-checkpoint-guard 2>$null; if ($LASTEXITCODE -ne 0) { git switch --track origin/codex/auto-checkpoint-guard }
npm run checkpoint:resume -- --task-id AUTO-CHECKPOINT-GUARD-20260825
```

This record never contains passwords, tokens, private keys, or .env content.
