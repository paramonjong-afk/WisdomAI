import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260830101500_employee_money_single_approval_queue.sql', 'utf8')
const ledgerMigration = readFileSync('supabase/migrations/20260826231000_employee_money_ledger.sql', 'utf8')

for (const marker of [
  'คิวยืนยันยอดตามวันเวลาโอนจริง',
  "order('transfer_at', { ascending: false, nullsFirst: false })",
  "entry.entry_status === 'matched_pending_review'",
  "review_employee_money_ledger_entry",
  "target_expected_version: entry.version",
  "reviewEmployeeMoney(entry, 'approve')",
  "reviewEmployeeMoney(entry, 'reject')",
  "entry.evidence_date_status !== 'verified'",
]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `page should contain ${marker}`)

for (const marker of ['entry.version', 'entry.reviewed_by', 'entry.reviewed_at', 'transaction.transfer_at', 'security_invoker = true']) {
  assert.match(migration, new RegExp(marker.replace('.', '\\.')), `view should expose ${marker}`)
}

assert.match(ledgerMigration, /exists\s*\(select 1 from public\.employee_money_ledger_audit[\s\S]+event_key = target_event_key\)/i)
assert.match(ledgerMigration, /before_row\.version <> target_expected_version/i)
assert.match(ledgerMigration, /insert into public\.employee_money_ledger_audit/i)
assert.doesNotMatch(migration, /insert\s+into|update\s+public|delete\s+from/i)
assert.doesNotMatch(page, /from\('employee_money_ledger_entries'\)\.insert|from\('employee_money_ledger_entries'\)\.update/)

console.log('employee money single approval queue: PASS')
