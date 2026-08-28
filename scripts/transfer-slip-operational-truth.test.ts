import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mapTransferSlipTruth, type TransferSlipOperationalTruthRow } from '../src/services/transferSlipOperationalTruth.ts'

const migration = fs.readFileSync(new URL('../supabase/migrations/20260826102135_transfer_slip_canonical_operational_truth.sql', import.meta.url), 'utf8')
const partyPairMigration = fs.readFileSync(new URL('../supabase/migrations/20260829120000_transfer_slip_confirmed_party_pair_projection.sql', import.meta.url), 'utf8')
assert.match(migration, /security_invoker\s*=\s*true/)
assert.match(migration, /evidence_sender_name/)
assert.match(migration, /canonical_payer_name/)
assert.match(migration, /is_postable/)
assert.match(migration, /grant select on table public\.transfer_slip_operational_truth_v1 to authenticated/)
assert.match(partyPairMigration, /party_identity_status/)
assert.match(partyPairMigration, /confirmed_pair/)
assert.match(partyPairMigration, /evidence_sender_account_last4/)
assert.match(partyPairMigration, /known_lineage\.confirmed_at is not null/)
assert.match(partyPairMigration, /known_tx\.review_status = 'confirmed'/)

const base: TransferSlipOperationalTruthRow = {
  task_id: 'task', task_status: 'queued', task_created_at: '2026-08-26T00:00:00Z', item_id: 'item', intake_id: 'intake', source_message_id: 'message',
  current_room: 'accounting', route_target: 'payment_verification', source_channel: 'line', source_room_name: 'room', source_sender_name: 'sender', source_received_at: '2026-08-26T00:00:00Z',
  data_review_status: 'rechecked', data_review_note: null, candidate_departments: ['accounting'], transaction_id: 'tx', review_status: 'pending', duplicate_of: null,
  expense_type: null, labor_amount: null, payment_party_confidence: 0.9, analysis_confidence: 0.9, analysis_model: 'model', notes: null,
  evidence_sender_name: 'OCR Sender', evidence_sender_bank_name: 'Bank', evidence_sender_account_last4: '1234', evidence_recipient_name: 'OCR Recipient', evidence_recipient_bank_name: 'Bank', evidence_recipient_account_last4: '5678',
  evidence_amount: 100, evidence_transfer_at: '2026-08-26T00:00:00Z', evidence_bank_reference: 'ref', truth_status: 'needs_review', is_postable: false,
  canonical_payer_name: null, canonical_fund_holder_name: null, canonical_beneficiary_name: null, canonical_amount: null,
  party_identity_status: 'unconfirmed', confirmed_party_payer_name: null, confirmed_party_beneficiary_name: null, party_identity_source_lineage_id: null, party_identity_confirmed_at: null,
}

const pending = mapTransferSlipTruth(base)
assert.equal(pending.isPostable, false)
assert.equal(pending.canonicalPayerName, null)
assert.equal(pending.senderName, 'OCR Sender')

const knownPair = mapTransferSlipTruth({ ...base, party_identity_status: 'confirmed_pair', confirmed_party_payer_name: 'Known Payer', confirmed_party_beneficiary_name: 'Known Recipient', party_identity_source_lineage_id: 'known-lineage', party_identity_confirmed_at: '2026-08-25T00:00:00Z' })
assert.equal(knownPair.isPostable, false)
assert.equal(knownPair.confirmedPartyPayerName, 'Known Payer')
assert.equal(knownPair.confirmedPartyBeneficiaryName, 'Known Recipient')
assert.equal(knownPair.partyIdentitySourceLineageId, 'known-lineage')

const confirmed = mapTransferSlipTruth({ ...base, truth_status: 'confirmed', is_postable: true, canonical_payer_name: 'Wisdom Power', canonical_beneficiary_name: 'Worker', canonical_amount: 100 })
assert.equal(confirmed.isPostable, true)
assert.equal(confirmed.canonicalPayerName, 'Wisdom Power')
assert.equal(confirmed.canonicalBeneficiaryName, 'Worker')
assert.equal(confirmed.canonicalAmount, 100)

console.log('transfer slip operational truth contract: PASS')
