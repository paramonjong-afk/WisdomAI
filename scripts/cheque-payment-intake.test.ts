import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const migration = readFileSync('supabase/migrations/20260822184233_cheque_payment_intake_flow.sql', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const intake = readFileSync('src/pages/IntakeRoom.tsx', 'utf8')
const lineWebhook = readFileSync('supabase/functions/line-webhook/index.ts', 'utf8')

assert.match(migration, /payment_evidence_type in \('transfer_slip','cheque_payment'\)/)
assert.match(migration, /apply_cheque_payment_dedupe/)
assert.match(migration, /review_status := 'duplicate'/)
assert.match(migration, /intake_cheque_review/)
assert.match(migration, /filter_cheque_verification/)
assert.match(migration, /revoke all on function public\.auto_route_cheque_payment_flow/)
assert.match(gateway, /loadChequePaymentEvidence/)
assert.match(intake, /ข้อมูลเช็คสั่งจ่าย/)
assert.match(intake, /cheque_payment/)
assert.match(lineWebhook, /is_cheque_payment: boolean/)
assert.match(lineWebhook, /payment_evidence_type: isChequePayment \? 'cheque_payment' : 'transfer_slip'/)
assert.match(lineWebhook, /result\.analysis\.financial_document\?\.is_cheque_payment/)

console.log('cheque payment intake flow contracts: ok')
