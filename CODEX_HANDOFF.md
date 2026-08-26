# WisdomAI - Canonical Codex Handoff

> Updated: 2026-08-26, Asia/Bangkok
> Purpose: durable source of truth for changing Codex/ChatGPT account or resuming from another machine.

## Resume First

1. Read `AGENTS.md`.
2. Read `docs/CODEX_ACCOUNT_SWITCH_HANDOFF.md`.
3. Read `docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md` and every Flow document related to the requested Module.
4. Read `docs/RELEASE_INCIDENT_PLAYBOOK.md` before any release or deployment.
5. Inspect Git status and remote state before editing. Never overwrite the existing dirty workspace.

## Authoritative System State

- Repository: `https://github.com/paramonjong-afk/WisdomAI`
- Primary local repository: `D:\WisdomAI-React`
- Production: `https://wisdomai.pages.dev`
- GitHub `main` and latest verified Production feature baseline: `36222b5`
- Production deployment path: clean commit -> GitHub `main` -> GitHub checks -> Cloudflare Git Integration -> `release.json` parity -> authenticated smoke test.
- Supabase project reference observed in prior verified work: `xkieyqixlufjqructjkr`. Do not infer credentials from this identifier.

## Current Priority

Close the first employee advance cycle end-to-end without duplicating cost:

`Intake -> Accounting -> Advance -> Payroll/Labor deduction -> Settlement -> Close`

Shared key: `Advance ID`. Preserve `Document ID`, source reference, attachments, audit events, actor, timestamp, latest comment, source Module, destination Module, and next action.

## Current Module Status

| Module | Status | Evidence / next action |
| --- | --- | --- |
| Intake and transfer slips | Production ready for current scope | Production revision `36222b5`; migration `20260826220000_transfer_slip_money_allocations_v2.sql`; Accounting Documents shows 78 transfer slips with source, parties, allocations, project/site, reconciliation and Audit. |
| Master Data | Incident fixed and deployed | Merge `d735a9a`; persisted action is verified after every RPC. One known candidate remains `needs_review` because the actual action was request-more-info, not confirmation. Continue Project -> Correction -> Recheck -> Confirm. |
| HR | Production ready for current scope | Revision `b37448b`; employee account candidate Drawer and authenticated smoke passed. Wrong-name account candidates are not auto-linked. |
| Web Chat / room 00 | Production ready for current scope | Revision `8c15c49`; owner-only Program Development room, Command Inbox and release incident standard verified. |
| Employee advance UI / evidence | Local and Production data paths implemented | Slip image preview and graphical Drawer timeline were verified locally for four Advance IDs. Confirmation MSG/Audit delivery was previously verified in Production. |
| Employee advance financial close | Not ready to permanently close | Review five attendance/time records, resolve three missing exit times, verify at least THB 2,750 labor evidence, assign a named Accounting owner, save reconciliation remark, apply payroll/labor deduction, approve, then close. |

## Known Work That Must Not Be Lost

- Main workspace `D:\WisdomAI-React` was dirty on 2026-08-26. Modified tracked files included `docs/CURRENT_WORK_STATUS.md`, `eslint.config.js`, `supabase/.temp/cli-latest`, and `supabase/functions/line-webhook/index.ts`, with several untracked worktree directories. Do not switch branches, clean, reset, or pull over that workspace.
- Existing stash: `stash@{0}: backup working tree before main sync 2026-08-25`. Do not apply or drop it without inspecting its owner and paths.
- Use a clean clone or isolated worktree based on current `origin/main` for all new work and releases.

## Remote Branches Requiring Review

These branches are not part of current `main` and are substantially behind it. Do not merge them wholesale.

| Branch | Head | State at handoff | Safe treatment |
| --- | --- | --- | --- |
| `codex/auto-checkpoint-guard` | `30d36a4` | 44 main commits behind, 6 unique commits | Review and port/rebase. It provides checkpoint manifest, handoff and resume commands. |
| `codex/flow-control-center-sync` | `3220da2` | 44 main commits behind, 7 unique commits | Compare against current Flow Control Center; cherry-pick only missing behavior after tests. |
| `codex/restore-mobile-github-guide` | `b3121d1` | 59 main commits behind, 1 unique document commit | Cherry-pick the single documentation commit if the mobile guide is still required on `main`. |

## Safety Rules

- Never read, print, commit, or transfer `.env`, `.env.local`, tokens, passwords, private keys, cookies, or browser session data.
- Never use `git reset --hard`, force push, destructive checkout, or delete business data.
- Preserve Raw/OCR evidence. Corrections must be append-only with before/after, actor, time, reason, source, version and Audit.
- Never mark a financial record permanently closed while evidence, payroll deduction, settlement or destination acceptance is incomplete.
- Never deploy from a dirty shared workspace. Use a clean branch/worktree and verify the complete operational path.

## Account Change Note

Repository commits, remote branches, Supabase data and Cloudflare Production do not depend on the local Codex conversation account. Conversation/task history visibility may depend on the signed-in account and must not be treated as the only source of truth. This Git handoff is the durable continuation point.

## New Account Prompt

Paste the following into the new Codex account after cloning/opening the repository:

```text
Open the WisdomAI repository and do not edit anything yet. Read AGENTS.md, CODEX_HANDOFF.md, docs/CODEX_ACCOUNT_SWITCH_HANDOFF.md, docs/FLOW_REGISTRY_UPDATE_PROTOCOL.md, docs/END_TO_END_CHANGE_EXECUTION_STANDARD.md, and docs/RELEASE_INCIDENT_PLAYBOOK.md. Then run read-only Git checks for status, current branch, origin/main, remote branches, and worktrees. Report: current Production revision, completed Modules, unresolved financial-close gates, dirty-workspace risks, and stale branches that require review. Do not read .env files, do not modify Production, do not switch or clean the dirty D:\WisdomAI-React workspace, and do not begin implementation until the handoff state is reconciled.
```

## Historical Codex Task References

These IDs help locate old task context only when the old account can still access it. Git documents and commits remain authoritative.

- Central: `01a02c09-3009-76e2-b9d4-26a4951751d3`
- General development: `01a02cb9-37ea-7310-84f6-1a54fa0617c3`
- Intake: `01a00d93-8dc4-7193-9999-a871e4adec02`
- Advance: `01a02bf2-9cbc-79f0-8dc1-5683a09e017c`
- HR: `01a00e01-6ce6-7571-bc0a-1550ee465429`
- Web Chat: `01a01394-1990-79c0-9815-b3e3dae3f8ad`
