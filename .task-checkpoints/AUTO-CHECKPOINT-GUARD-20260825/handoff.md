# Task Handoff: AUTO-CHECKPOINT-GUARD-20260825

| Field | Value |
| --- | --- |
| Title | Auto Checkpoint Guard |
| Module | platform-release |
| Owner room | program-general |
| Status | checkpointed |
| Branch | `codex/auto-checkpoint-guard` |
| Base commit | `aba6406d23ae431bfd7d3b3969784b6de2816e45` |
| Checkpoint commit | `a1bcbb95c05d5b1fdd31afd6438dc87678ac3667` |
| Remote | `origin` |
| Updated | 2026-08-25T11:18:59.985Z |
| Actor | codex-program-general |

## Objective

Preserve source and handoff context safely across usage limits, compaction, tool instability, and Codex account changes.

## Done

- Inspected repository policies, release conventions, Flow Registry, and dirty workspace.
- Implemented CLI, policy, Flow documentation, example, and Git contract tests.
- Contract tests passed for protected branch, explicit paths, unrelated files, no-op, failed test/push, and cross-worktree resume.
- Targeted lint and typecheck passed before the self-hosted checkpoint.

## Pending

- Run the configured checkpoint gates and push the work branch.
- Run all configured gates and push the dedicated branch.

## Blocker

none

## Next Action

Execute the self-hosted checkpoint and verify the remote branch.

## Tests

| Command | Result | Ran at | Exit code |
| --- | --- | --- | --- |
| `npm run test:auto-checkpoint` | passed | 2026-08-25T11:17:06.192Z | 0 |
| `npx eslint scripts/task-checkpoint-guard.ts scripts/task-checkpoint-guard.test.ts --no-warn-ignored` | passed | 2026-08-25T11:17:15.020Z | 0 |
| `npm run typecheck` | passed | 2026-08-25T11:17:59.781Z | 0 |
| `npm run build` | passed | 2026-08-25T11:18:58.225Z | 0 |

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
