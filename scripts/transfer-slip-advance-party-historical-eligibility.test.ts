import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260828165518_fix_advance_party_historical_employee_eligibility.sql', 'utf8')
const resolver = readFileSync('supabase/migrations/20260827003009_transfer_slip_advance_party_auto_link.sql', 'utf8')

for (const marker of [
  'resolve_transfer_slip_advance_parties',
  'transaction_row.transfer_at',
  'employment.payroll_eligible_until',
  'employment.last_working_on',
  'employment.terminated_on',
  "at time zone ''Asia/Bangkok''",
  'unexpected_eligibility_definition',
]) assert.ok(migration.includes(marker), `missing historical eligibility marker: ${marker}`)

assert.match(resolver, /employment\.employment_type='daily'/)
assert.match(resolver, /normalize_employee_payment_name\(profile\.full_name\)=recipient_normalized/)
assert.doesNotMatch(migration, /delete\s+from|update\s+public\.employee_employment_records|insert\s+into\s+public\.employee_employment_records/i)

const eligibleOnTransfer = (status: string, transferDate: string, eligibleUntil: string | null) =>
  ['active', 'probation', 'notice'].includes(status) || (status === 'terminated' && Boolean(eligibleUntil && eligibleUntil >= transferDate))

assert.equal(eligibleOnTransfer('terminated', '2026-08-02', '2026-08-06'), true)
assert.equal(eligibleOnTransfer('terminated', '2026-08-07', '2026-08-06'), false)
assert.equal(eligibleOnTransfer('active', '2026-08-28', null), true)

console.log('transfer slip advance-party historical employee eligibility: PASS')
