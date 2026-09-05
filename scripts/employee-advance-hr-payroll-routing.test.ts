import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260831031554_route_approved_employee_advances_to_hr_payroll.sql', 'utf8')
const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')

for (const marker of [
  "entry_row.entry_type <> 'advance_issued'",
  "entry_row.account_scope <> 'advance'",
  "entry_row.entry_status <> 'approved'",
  'employee_money_pay_period_assignments',
  "current_room = 'hr_payroll_advance_queue'",
  "target_department = 'hr'",
  "next_destination = 'payroll'",
  "'employee_advance_routed_to_hr_payroll'",
  "'routed_to_hr_payroll'",
  'on conflict(company_id, event_key) do nothing',
]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `migration should contain ${marker}`)

assert.match(migration, /revoke all on function public\.route_approved_employee_advance_to_hr_payroll\(uuid, text\)[\s\S]+from public, anon, authenticated/i)
assert.match(migration, /after insert or update of entry_status, entry_type, account_scope, source_flow_item_id/i)
assert.match(migration, /after insert or update of pay_period_id/i)
assert.doesNotMatch(migration, /delete\s+from\s+public\.employee_money/i)

for (const marker of [
  'hr_payroll_advance_queue',
  'บัญชี · รอยืนยันยอด',
  'HR/Payroll · รอปิดงวด',
  'HR ตรวจงวดและหักเมื่อปิดงวด',
]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `page should contain ${marker}`)

console.log('employee advance HR/Payroll routing contract: PASS')
