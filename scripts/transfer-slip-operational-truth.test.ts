import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mapTransferSlipTruth, type TransferSlipOperationalTruthRow } from '../src/services/transferSlipOperationalTruth.ts'

const migration = fs.readFileSync(new URL('../supabase/migrations/20260826102135_transfer_slip_canonical_operational_truth.sql', import.meta.url), 'utf8')
assert.match(migration, /security_invoker\s*=\s*true/)
assert.match(migration, /evidence_sender_name/)
assert.match(migration, /canonical_payer_name/)
assert.match(migration, /is_postable/)
assert.match(migration, /grant select on table public\.transfer_slip_operational_truth_v1 to authenticated/)

const base: TransferSlipOperationalTruthRow = {
  task_id: 'task', task_status: 'queued', task_created_at: '2026-08-26T00:00:00Z', item_id: 'item', intake_id: 'intake', source_message_id: 'message',
  current_room: 'accounting', route_target: 'payment_verification', source_channel: 'line', source_room_name: 'room', source_sender_name: 'sender', source_received_at: '2026-08-26T00:00:00Z',
  data_review_status: 'rechecked', data_review_note: null, candidate_departments: ['accounting'], transaction_id: 'tx', review_status: 'pending', duplicate_of: null,
  expense_type: null, labor_amount: null, payment_party_confidence: 0.9, analysis_confidence: 0.9, analysis_model: 'model', notes: null,
  evidence_sender_name: 'OCR Sender', evidence_sender_bank_name: 'Bank', evidence_sender_account_last4: '1234', evidence_recipient_name: 'OCR Recipient', evidence_recipient_bank_name: 'Bank', evidence_recipient_account_last4: '5678',
  evidence_amount: 100, evidence_transfer_at: '2026-08-26T00:00:00Z', evidence_bank_reference: 'ref', truth_status: 'needs_review', is_postable: false,
  canonical_payer_name: null, canonical_fund_holder_name: null, canonical_beneficiary_name: null, canonical_amount: null,
}

const pending = mapTransferSlipTruth(base)
assert.equal(pending.isPostable, false)
assert.equal(pending.canonicalPayerName, null)
assert.equal(pending.senderName, 'OCR Sender')

const confirmed = mapTransferSlipTruth({ ...base, truth_status: 'confirmed', is_postable: true, canonical_payer_name: 'Wisdom Power', canonical_beneficiary_name: 'Worker', canonical_amount: 100 })
assert.equal(confirmed.isPostable, true)
assert.equal(confirmed.canonicalPayerName, 'Wisdom Power')
assert.equal(confirmed.canonicalBeneficiaryName, 'Worker')
assert.equal(confirmed.canonicalAmount, 100)

console.log('transfer slip operational truth contract: PASS')
