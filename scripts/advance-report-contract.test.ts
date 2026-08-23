import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const gateway = readFileSync('src/services/advanceReportGateway.ts', 'utf8')
const page = readFileSync('src/pages/Reports/AdvancePaymentReport.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260820233529_employee_advance_settlement_flow.sql', 'utf8')

for (const table of ['employee_advance_cases', 'financial_transactions', 'document_flow_items', 'employee_advance_settlement_items', 'employee_advance_audit']) {
  assert.match(gateway, new RegExp(table), `gateway must use ${table}`)
}
for (const field of ['recipient_name', 'amount_total', 'transfer_at', 'bank_reference', 'review_status', 'duplicate_of', 'payment_party_confidence']) {
  assert.match(gateway, new RegExp(field), `gateway must map ${field}`)
}
for (const action of ['submit', 'approve', 'return', 'close']) {
  assert.match(migration, new RegExp(`target_action='${action}'`), `source RPC must support ${action}`)
}
assert.match(gateway, /transition_employee_advance_case/)
assert.match(gateway, /calculateAdvanceBalance/)
assert.match(gateway, /isDuplicateAdvance/)
assert.match(gateway, /summarizeAdvanceRows/)
assert.match(gateway, /bangkokNextDayStart\(to\)/)
assert.match(page, /filterAdvanceRows/)
assert.match(page, /documentFlowGateway\.preview/)
assert.match(page, /selected\.audit\.map/)
assert.match(page, /Reject สลิปทำที่ Intake\/Document Flow/)
console.log('advance report contract checks passed')
