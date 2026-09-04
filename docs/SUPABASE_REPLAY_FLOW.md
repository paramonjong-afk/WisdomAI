```mermaid
flowchart TD
  A[Reviewed migration history] --> B[Isolated empty database]
  B --> C[Replay every migration in order]
  C --> D{One-time identity repair}
  D -->|No auth users AND no profiles| E[No applicable identity - return notice]
  D -->|Either table populated| F[Original identity and role checks]
  F -->|Ambiguous or missing target| G[Fail and block merge]
  E --> H[Continue replay]
  F -->|Validated| H
  H --> K{Historical completion reconciliation}
  K -->|No users, profiles or target work item| L[No historical UAT evidence to reconcile]
  K -->|Existing identities or target row| M[Original completion assertion]
  M -->|Invalid state| G
  M -->|Validated| I[Linked dry-run]
  L --> N[Create allocations then attach vendor-match trigger]
  N --> O{Historical salary correction}
  O -->|No identities, documents or allocations| I
  O -->|Any existing data| P[Original target, amount and source checks]
  P -->|Valid| Q[Preserve ledger view columns and reviewed pay period]
  Q --> I
  P -->|Invalid| G
  I --> J[Human PR review]
```

# Supabase Replay Flow - SYS-CICD-001

Version: 2026-09-04. Owner: Platform / database maintainer.

Inputs are versioned SQL and an isolated database, never copied personal data.
Outputs are the CI replay result and a reviewed dry-run; successful targeted
tests alone do not establish migration history or Production readiness.

The two historical Telegram identity repairs (202608090018 and 202608090019)
have no applicable record before any auth user or profile exists. They now
return a notice only in that state. Once either table contains data, all
original missing/ambiguous identity, company and admin-role checks still run.
No global CI skip flag, exception suppression or fake identity is used.
Do not replay these repairs manually on Production.

`npm run test:legacy-identity-replay` executes both actual migration files in
in-memory PostgreSQL across pristine, auth-only, profile-only and populated
scenarios. Pristine replay is repeated to verify idempotency. Other scenarios
must still fail on an unmatched target. It performs no network or business writes.

Changes to already-applied SQL affect fresh replay, not an existing applied
version. Remote history parity and the provisional profiles/projects foundation
must still be reviewed before merge. Do not repair remote history to hide drift.

Audit: retain CI logs, PR review and work-item evidence. Retry only after a
specific failure is diagnosed. Rollback before merge is a new revert commit
on the task branch; no Production rollback is needed because nothing is applied.

Source reference: https://supabase.com/docs/guides/deployment/database-migrations

## 2026-09-05 replay follow-up

CI run 33915679999 passed the identity guards and failed at 202608150016:
the historical LINE completion assertion expected a work item absent from a
fresh installation. It now returns only if auth users, profiles and the target
work item are all absent. Existing identities or a target in any scope retain
the assertion. No completed work item or UAT evidence is synthesized.

The same test command now runs 14 PostgreSQL scenarios. The six reconciliation
cases cover pristine repeated replay, auth-only, profile-only, invalid target,
wrong-scope target and a valid review target. They verify preserved prior
evidence, idempotency and unchanged unrelated rows. Full replay is still required.

CI run 33916274015 passed that guard and reached a dependency-order failure:
20260826044252 attached a trigger to allocations created by 20260826220000.
The earlier migration attaches immediately when the table already exists;
the table-creation migration always attaches it after creation. The vendor
validation function and its matching rules are unchanged. Migration filenames
and remote history are unchanged; do not manually reapply them to Production.

`node scripts/vendor-trigger-replay.test.mjs` executes the actual trigger SQL
and table-creation SQL in isolated PostgreSQL for fresh and existing tables.
It checks repeated installation, rejected unmatched vendor insert/update,
accepted matched confirmation and unchanged non-vendor behavior. This scoped
test does not replace full migration replay or linked dry-run.

CI run 33916675589 passed vendor table attachment and found a missing fixed
salary-correction target at 20260829103500. This historical correction now
returns only when auth users, profiles, document items and allocations are all
empty. Its target, amount and source checks remain unchanged for populated
databases. No payroll record, confirmation or audit evidence is fabricated.

`node scripts/salary-correction-replay.test.mjs` executes the complete SQL in
five isolated PostgreSQL scenarios: pristine repeated replay and each of the
four guarded tables populated independently. It asserts original rejection
when the historical target is absent and verifies no rows/evidence are created
or deleted. Full CI replay and linked dry-run remain required before merge.

CI run 33917055323 passed the salary correction and failed at 20260830101500:
the replacement ledger view omitted existing assignment method/reason columns
and the canonical reviewed-period join. Restore the prior column order, join
and coalesce expression; preserve security_invoker and grants without dropping
the view. `node scripts/ledger-view-replay.test.mjs` executes the previous view
then the replacement twice and verifies schema compatibility, reviewed-period
precedence, allocation fallback, version metadata and access properties.
