import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260830035652_reconcile_wage_money_lines.sql', 'utf8')

for (const required of [
  'canonicalEmployeeMoneyEntries',
  "entry.entry_type === 'wage_paid'",
  'financial_transaction_id',
  'allocation_id',
  'ค่าแรงตามเส้นเงินจริง',
  'บัญชี + HR',
  'ยังไม่ผูกรอบ',
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
console.log('wage money workflow contract tests passed')
