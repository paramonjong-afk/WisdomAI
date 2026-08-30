import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260830035652_reconcile_wage_money_lines.sql', 'utf8')
const periodMigration = readFileSync('supabase/migrations/20260830054524_assign_wage_pay_period_workflow.sql', 'utf8')
const interimAdvanceMigration = readFileSync('supabase/migrations/20260830061245_classify_interim_employee_transfers_as_advances.sql', 'utf8')

for (const required of [
  'canonicalEmployeeMoneyEntries',
  "entry.entry_type === 'advance_issued'",
  'financial_transaction_id',
  'allocation_id',
  'เงินเบิกล่วงหน้าระหว่างงวด',
  'งวดที่จะหัก',
  'สร้าง Adjustment',
  'บัญชี + HR',
  'ยังไม่ผูกงวด',
]) assert.ok(page.includes(required), `wage workflow UI should include ${required}`)

for (const required of [
  "entry_status = 'reversed'",
  'legacy_projection_reversed',
  'replaced_by_entry_id',
  'employee_money_ledger_audit',
  'security_invoker = true',
  'flow.candidate_departments',
  "revoke all on public.employee_money_ledger_detail_v1 from public, anon",
]) assert.ok(migration.toLowerCase().includes(required.toLowerCase()), `wage reconciliation should include ${required}`)

assert.doesNotMatch(migration, /delete\s+from\s+public\.employee_money_ledger_entries/i)

for (const required of [
  'employee_money_pay_period_assignments',
  'auto_assign_employee_money_pay_period',
  'assign_employee_money_pay_period',
  'transfer_date_auto',
  "period_count <> 1",
  "period.status not in ('closed', 'paying', 'paid', 'cancelled')",
  'pay_period_auto_assigned',
  'security_invoker = true',
]) assert.ok(periodMigration.includes(required), `pay-period workflow should include ${required}`)

assert.doesNotMatch(periodMigration, /delete\s+from\s+public\./i)

for (const required of [
  'duplicate_projection_reversed',
  'interim_transfer_reclassified_as_advance',
  "entry_type = 'advance_issued'",
  "account_scope = 'advance'",
  'employee_money_period_summary_v1',
  'approved_adjustment_net',
  'advance_to_deduct',
  'security_invoker = true',
  "period.status not in ('closed', 'paying', 'paid', 'cancelled')",
  'employee_money_ledger_audit',
]) assert.ok(interimAdvanceMigration.includes(required), `interim advance workflow should include ${required}`)

assert.doesNotMatch(interimAdvanceMigration, /delete\s+from\s+public\./i)
assert.match(interimAdvanceMigration, /entry\.entry_status\s*=\s*'matched_pending_review'/i)
assert.match(interimAdvanceMigration, /allocation\.status\s*=\s*'superseded'/i)

console.log('interim advance and pay-period workflow contract tests passed')
