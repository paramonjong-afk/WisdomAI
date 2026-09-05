import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migrationsDir = join(root, 'supabase', 'migrations')
const files = readdirSync(migrationsDir).filter(file => file.endsWith('.sql'))

const renamed = [
  ['20260828174300_master_data_canonical_auto_propagation.sql', '20260828174711_master_data_canonical_auto_propagation.sql'],
  ['20260828175115_mark_canonical_match_conflicts.sql', '20260828175309_mark_canonical_match_conflicts.sql'],
  ['20260829093000_keep_material_transfer_slips_out_of_inventory.sql', '20260828184044_keep_material_transfer_slips_out_of_inventory.sql'],
  ['20260829120000_transfer_slip_confirmed_party_pair_projection.sql', '20260828222133_transfer_slip_confirmed_party_pair_projection.sql'],
  ['20260829153000_sync_confirmed_transfer_parties_to_canonical_master.sql', '20260828224845_sync_confirmed_transfer_parties_to_canonical_master.sql'],
  ['20260829154500_reconcile_canonical_bank_account_duplicates.sql', '20260828225159_reconcile_canonical_bank_account_duplicates.sql'],
  ['20260828232359_promptpay_canonical_payment_aliases.sql', '20260828233534_promptpay_canonical_payment_aliases.sql'],
  ['20260828233606_backfill_promptpay_party_links.sql', '20260828233638_backfill_promptpay_party_links.sql'],
  ['20260829161000_prevent_control_fund_expense_accounts.sql', '20260829093532_prevent_control_fund_expense_accounts.sql'],
  ['20260829101553_backfill_salary_advance_reconciliation.sql', '20260829101758_backfill_salary_advance_reconciliation.sql'],
  ['20260829115423_money_route_policy_registry.sql', '20260829120637_money_route_policy_registry.sql'],
  ['20260830024834_employee_money_pay_period_allocations.sql', '20260830025544_employee_money_pay_period_allocations.sql'],
  ['20260830035652_reconcile_wage_money_lines.sql', '20260830040047_reconcile_wage_money_lines.sql'],
  ['20260830062132_backfill_employee_advance_effective_date.sql', '20260830062231_backfill_employee_advance_effective_date.sql'],
  ['20260831113000_route_approved_employee_advances_to_hr_payroll.sql', '20260831031554_route_approved_employee_advances_to_hr_payroll.sql'],
  ['20260831023857_sales_expense_accounting_workflow.sql', '20260831040817_sales_expense_accounting_workflow.sql'],
]

const markers = [
  '20260827132442_employee_private_chat_rooms.sql',
  '20260828191645_classify_salary_payroll_evidence.sql',
  '20260829101453_reconcile_salary_from_employee_advances.sql',
  '20260829115444_daily_wage_transfer_delivery_trigger.sql',
  '20260829115549_daily_wage_transfer_private_delivery.sql',
  '20260829120803_daily_wage_transfer_slip_attachment_delivery.sql',
  '20260829175308_employee_advance_reject_restore.sql',
  '20260830055057_assign_wage_pay_period_workflow.sql',
  '20260830062009_classify_interim_employee_transfers_as_advances.sql',
]

const corrections = [
  '20260905110000_reconcile_confirmed_salary_employee_advance.sql',
  '20260905110100_confirm_salary_payroll_evidence.sql',
  '20260905110200_employee_advance_reject_restore_correction.sql',
  '20260905110300_assign_wage_pay_period_workflow_correction.sql',
  '20260905110400_classify_interim_employee_transfers_as_advances_correction.sql',
]

const obsoleteHistoricalCorrections = [
  '20260829101053_reconcile_salary_from_employee_advances.sql',
  '20260829103500_classify_salary_payroll_evidence.sql',
  '20260829173946_employee_advance_reject_restore.sql',
  '20260830054524_assign_wage_pay_period_workflow.sql',
  '20260830061245_classify_interim_employee_transfers_as_advances.sql',
]

for (const [oldName, productionName] of renamed) {
  assert.equal(existsSync(join(migrationsDir, oldName)), false, `obsolete local version remains: ${oldName}`)
  assert.equal(existsSync(join(migrationsDir, productionName)), true, `Production version missing: ${productionName}`)
}

for (const marker of markers) {
  const sql = readFileSync(join(migrationsDir, marker), 'utf8')
  const executable = sql.replace(/--[^\r\n]*/g, '').trim()
  assert.equal(executable, '', `historical marker must never contain executable SQL: ${marker}`)
}

for (const correction of corrections) {
  assert.equal(existsSync(join(migrationsDir, correction)), true, `corrective migration missing: ${correction}`)
}

for (const obsolete of obsoleteHistoricalCorrections) {
  assert.equal(existsSync(join(migrationsDir, obsolete)), false, `historical correction must be re-versioned: ${obsolete}`)
}

const versions = files.map(file => file.match(/^(\d+)_/)?.[1]).filter(Boolean)
assert.equal(new Set(versions).size, versions.length, 'migration version IDs must be unique')
console.log('Migration history reconciliation: 16 aligned versions, 9 inert markers, 5 corrections re-versioned')
