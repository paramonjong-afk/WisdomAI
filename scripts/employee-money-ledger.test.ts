import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateEmployeeMoneyBalance, calculatePayrollOffsetPreview, normalizeEmployeePaymentName } from '../src/services/employeeMoneyLedger.ts'

assert.equal(normalizeEmployeePaymentName('นาย พัฒนรัตน์ กันดี'), normalizeEmployeePaymentName('พัฒนรัตน์  กันดี'))
assert.equal(normalizeEmployeePaymentName('ช่าง ภูธเรศ ภาวจันถึก'), 'ภูธเรศภาวจันถึก')
assert.equal(normalizeEmployeePaymentName('น.ส. วรนุช มูลเหลา'), normalizeEmployeePaymentName('วรนุช มูลเหลา'))
assert.notEqual(normalizeEmployeePaymentName('นาย ภูธเรศ ภาวจันทึก'), normalizeEmployeePaymentName('นาย ภูธเรศ ภาวจันถึก'))

const balance = calculateEmployeeMoneyBalance([
  { accountScope: 'advance', entryType: 'advance_issued', amount: 400, status: 'approved' },
  { accountScope: 'advance', entryType: 'advance_issued', amount: 100, status: 'matched_pending_review' },
  { accountScope: 'wage', entryType: 'wage_paid', amount: 1487, status: 'approved' },
  { accountScope: 'wage', entryType: 'wage_paid', amount: 1350, status: 'matched_pending_review' },
  { accountScope: 'advance', entryType: 'reversal', amount: 100, status: 'rejected' },
])
assert.deepEqual(balance, { approvedAdvanceBalance: 400, approvedWagePaid: 1487, pendingAdvanceAmount: 100, pendingWagePaid: 1350 })

assert.deepEqual(calculatePayrollOffsetPreview({
  grossWage: 3150,
  approvedWagePaid: 1487,
  approvedAdvanceBalance: 500,
}), {
  grossAndAdditions: 3150,
  availableBeforeAdvance: 1663,
  advanceRecovery: 500,
  netCashDue: 1163,
  closingAdvanceBalance: 0,
  wageCreditCarry: 0,
})

assert.deepEqual(calculatePayrollOffsetPreview({
  grossWage: 900,
  otherDeductions: 100,
  approvedWagePaid: 700,
  approvedAdvanceBalance: 500,
}), {
  grossAndAdditions: 900,
  availableBeforeAdvance: 100,
  advanceRecovery: 100,
  netCashDue: 0,
  closingAdvanceBalance: 400,
  wageCreditCarry: 0,
})

const migration = readFileSync('supabase/migrations/20260826231000_employee_money_ledger.sql', 'utf8')
const backfill = readFileSync('supabase/migrations/20260826231500_employee_money_legacy_backfill.sql', 'utf8')
const dailyAdvanceReconcile = readFileSync('supabase/migrations/20260826235253_reconcile_daily_employee_advance_routing.sql', 'utf8')
const dailyAdvanceDestinationFix = readFileSync('supabase/migrations/20260826235415_fix_daily_employee_advance_destination.sql', 'utf8')
for (const marker of [
  'employee_money_ledger_entries',
  'employee_money_ledger_audit',
  'employee_money_match_queue',
  'normalize_employee_payment_name',
  'project_employee_money_source',
  'queue_legacy_employee_money_match',
  'review_employee_money_ledger_entry',
  'create_employee_money_adjustment',
  'employee_money_balance_summary',
  'matched_pending_review',
  'source_key',
]) assert.match(migration, new RegExp(marker), `migration should contain ${marker}`)
assert.doesNotMatch(migration, /delete\s+from\s+public\.employee_money_ledger_entries/i)
assert.match(migration, /revoke\s+insert\s*,\s*update\s*,\s*delete[\s\S]+employee_money_ledger_entries/i)
assert.match(backfill, /employee_money_legacy_candidates/i)
assert.match(backfill, /expense_type = 'advance'/i)
assert.match(backfill, /expense_type = 'labor' and review_status = 'confirmed'/i)
assert.match(backfill, /project_employee_money_source/i)
assert.doesNotMatch(backfill, /employee_payrolls|employee_payroll_lines|delete\s+from/i)
assert.match(dailyAdvanceReconcile, /payroll_eligible_until/)
assert.match(dailyAdvanceReconcile, /employee_money_review_queue/)
assert.match(dailyAdvanceReconcile, /target_decision => target_decision/)
assert.doesNotMatch(dailyAdvanceReconcile, /for source_row in|with confirmed_sources as/)
assert.doesNotMatch(dailyAdvanceReconcile, /delete\s+from/i)
assert.match(dailyAdvanceDestinationFix, /next_destination = ''advance_finance''/)

console.log('employee money ledger contract and math: PASS')
