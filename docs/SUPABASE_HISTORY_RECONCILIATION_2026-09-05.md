# Read-only migration reconciliation

Date: 2026-09-05. Task: SYS-CICD-001. Status: controlled baseline repair and
future-version corrections prepared after the guarded Production dry-run.

## Source reconciliation prepared

- Aligned 16 source filenames with the already-recorded Production version IDs
  only after the preserved SQL bodies passed the strict outer-trim comparison.
  File contents were not changed.
- Added eight comment-only markers for already-recorded Production versions
  and one executable replay bootstrap at the recorded pay-period version.
  Four originals contain historical room/message delivery backfills and are
  deliberately not replayed. Five have a later corrective source migration,
  which remains separately versioned and executable.
- The five corrective migrations are re-versioned after the current Production
  history tip; their obsolete historical local-only filenames are removed.
- migration-history-reconciliation.test.mjs locks the 16 renames, eight inert
  markers, one replay bootstrap, five corrections, and global version
  uniqueness. The marker test rejects executable SQL while the bootstrap test
  locks its required table and view.

The source reconciliation itself did not edit Production. The controlled
release adds one narrowly scoped history repair for the replay-only foundation
after live schema verification, then applies only future-version migrations
through the normal push command. Complete replay and Production dry-run remain
mandatory, and real apply must never use `--include-all`.

## Evidence

- Source: authenticated Supabase connector, project xkieyqixlufjqructjkr.
- Read only supabase_migrations.schema_migrations metadata; no business records.
- Remote versions: 379; latest: 20260831134117.
- Local SQL files: 380; shared version IDs: 354.
- Local-only IDs: 26; remote-only IDs: 25.
- PR 28 remains draft/open, unmerged; remote head fc384f0.
- Local recovery code commit d8c0b7d is not on remote yet.
- User's password test result is unknown. No repeated password attempt performed.

## Screening method and limits

Compared local filenames against remote versions. For pairing candidates only,
compared MD5 of text with whitespace removed: local complete file versus remote
statements joined by newline. This is NOT a SQL-equivalence/security check:
whitespace inside literals, statement splitting, comments, and serialization
can produce misleading matches or differences. A pair requires raw SQL review,
statement-order/transaction review, and live schema verification before action.
Only 16 shared IDs matched this screening fingerprint; the other 338 are NOT
proven schema drift. Do not infer changed business data from those fingerprints.
No history repair, rename, replay, schema change or migration apply was performed.

## Remote-only version candidates

17 candidate pairs; 8 without a matching screening fingerprint.

| Remote version | Recorded name | Local candidate (not approved) |
| --- | --- | --- |
| 20260827132442 | employee_private_chat_rooms | Needs review |
| 20260828174711 | master_data_canonical_auto_propagation | 20260828174300_master_data_canonical_auto_propagation.sql |
| 20260828175309 | mark_canonical_match_conflicts | 20260828175115_mark_canonical_match_conflicts.sql |
| 20260828184044 | keep_material_transfer_slips_out_of_inventory | 20260829093000_keep_material_transfer_slips_out_of_inventory.sql |
| 20260828191645 | classify_salary_payroll_evidence | Needs review |
| 20260828222133 | transfer_slip_confirmed_party_pair_projection | 20260829120000_transfer_slip_confirmed_party_pair_projection.sql |
| 20260828224845 | sync_confirmed_transfer_parties_to_canonical_master | 20260829153000_sync_confirmed_transfer_parties_to_canonical_master.sql |
| 20260828225159 | reconcile_canonical_bank_account_duplicates | 20260829154500_reconcile_canonical_bank_account_duplicates.sql |
| 20260828233534 | promptpay_canonical_payment_aliases | 20260828232359_promptpay_canonical_payment_aliases.sql |
| 20260828233638 | backfill_promptpay_party_links | 20260828233606_backfill_promptpay_party_links.sql |
| 20260829093532 | prevent_control_fund_expense_accounts | 20260829161000_prevent_control_fund_expense_accounts.sql |
| 20260829101453 | reconcile_salary_from_employee_advances | Needs review |
| 20260829101758 | backfill_salary_advance_reconciliation | 20260829101553_backfill_salary_advance_reconciliation.sql |
| 20260829115444 | daily_wage_transfer_delivery_trigger | Needs review |
| 20260829115549 | daily_wage_transfer_private_delivery | Needs review |
| 20260829120637 | money_route_policy_registry | 20260829115423_money_route_policy_registry.sql |
| 20260829120803 | daily_wage_transfer_slip_attachment_delivery | Needs review |
| 20260829175308 | employee_advance_reject_restore | 20260829173946_employee_advance_reject_restore.sql |
| 20260830025544 | employee_money_pay_period_allocations | 20260830024834_employee_money_pay_period_allocations.sql |
| 20260830040047 | reconcile_wage_money_lines | 20260830035652_reconcile_wage_money_lines.sql |
| 20260830055057 | assign_wage_pay_period_workflow | Needs review |
| 20260830062009 | classify_interim_employee_transfers_as_advances | Needs review |
| 20260830062231 | backfill_employee_advance_effective_date | 20260830062132_backfill_employee_advance_effective_date.sql |
| 20260831031554 | route_approved_employee_advances_to_hr_payroll | 20260831113000_route_approved_employee_advances_to_hr_payroll.sql |
| 20260831040817 | sales_expense_accounting_workflow | 20260831023857_sales_expense_accounting_workflow.sql |

## Initial local-only files before controlled release

- 202607210000_profiles_foundation.sql
- 20260828174300_master_data_canonical_auto_propagation.sql
- 20260828175115_mark_canonical_match_conflicts.sql
- 20260828232359_promptpay_canonical_payment_aliases.sql
- 20260828233606_backfill_promptpay_party_links.sql
- 20260829093000_keep_material_transfer_slips_out_of_inventory.sql
- 20260829101053_reconcile_salary_from_employee_advances.sql
- 20260829101553_backfill_salary_advance_reconciliation.sql
- 20260829103500_classify_salary_payroll_evidence.sql
- 20260829115423_money_route_policy_registry.sql
- 20260829120000_transfer_slip_confirmed_party_pair_projection.sql
- 20260829153000_sync_confirmed_transfer_parties_to_canonical_master.sql
- 20260829154500_reconcile_canonical_bank_account_duplicates.sql
- 20260829161000_prevent_control_fund_expense_accounts.sql
- 20260829173946_employee_advance_reject_restore.sql
- 20260830024834_employee_money_pay_period_allocations.sql
- 20260830035652_reconcile_wage_money_lines.sql
- 20260830054524_assign_wage_pay_period_workflow.sql
- 20260830061245_classify_interim_employee_transfers_as_advances.sql
- 20260830062132_backfill_employee_advance_effective_date.sql
- 20260831023857_sales_expense_accounting_workflow.sql
- 20260831113000_route_approved_employee_advances_to_hr_payroll.sql
- 20260901090000_enable_advance_holder_realtime.sql
- 20260903123000_advance_holder_owner_visibility.sql
- 20260904120000_recover_orphaned_system_work_item_claims.sql
- 20260904130000_bounded_retry_and_escalation_alerts.sql

## Additional read-only findings

- All 7 tables named by the Advance Holder realtime migration are already
  members of supabase_realtime on Production.
- All 6 named owner SELECT policies exist with authenticated role and company /
  holder predicates; RLS enabled on all 6 affected tables. This is schema
  evidence only, NOT a three-user authenticated realtime smoke test.
- recover_stale_system_work_items exists and its cron is active every 15 minutes.
  Function existence does not establish equivalence with the new source body.
- claim_system_work_item currently has the old two-argument signature;
  reset_system_work_item_retry is absent; escalation cron absent. The newer
  retry-cap source cannot be declared deployed.
- Stronger text screening (only CRLF normalization and outer trim, preserving
  internal whitespace/literals) gives 16 cross-version matches, not 17. The
  employee_advance_reject_restore candidate fails this stricter comparison.
  Hash matches still require review; no history update is approved.
- Local repository has no same-name SQL files for employee_private_chat_rooms
  and the three daily_wage_transfer delivery migrations. Do not fabricate them
  or assume the similarly named intake-routing files are equivalent.

The API diagnostic now distinguishes unsafe remote-only drift from legitimate
local migrations awaiting dry-run. Remote-only versions and duplicate IDs fail;
local-only versions are reported as `local_migrations_pending_dry_run` so the
replay and linked dry-run can continue. Every result keeps
`apply_authorized=false`. It performs GET only; existing replay/linked dry-run
gates remain mandatory.

The historical guard now permits only the `202607210000` replay foundation to
be absent from Production history. Before repairing that one history row, the
apply job verifies the required `profiles` and `projects` tables and UUID key
columns over the pinned TLS connection. Repair is idempotent and refuses an
ambiguous history count. No other migration version may be repaired.

The five executable corrections were moved after the Production history tip:

- `20260905110000_reconcile_confirmed_salary_employee_advance.sql`
- `20260905110100_confirm_salary_payroll_evidence.sql`
- `20260905110200_employee_advance_reject_restore_correction.sql`
- `20260905110300_assign_wage_pay_period_workflow_correction.sql`
- `20260905110400_classify_interim_employee_transfers_as_advances_correction.sql`

The real apply command remains plain `db push` without `--include-all`. The
guarded flag remains dry-run-only. Read-only impact checks found the confirmed
salary source record, no linked active advances to cancel, and no interim wage
rows requiring bulk reclassification before this release.

## Remaining release steps

1. Run the reconciliation, workflow, safety and complete replay contracts.
2. Require GitHub replay and the exact linked Production dry-run on the PR.
3. Merge only after the owner approves the baseline repair and resulting
   Production changes.
4. Verify the repaired history row, all future migration versions, functions,
   schema and authenticated runtime after the main workflow succeeds.

Rollback before merge: close the PR. After apply, use forward-only corrective
migrations; never delete Production history or reset the remote database. No
password/token is stored here.
