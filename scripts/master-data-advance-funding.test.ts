import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyLocalAdvanceFunding, inferMasterRecordingMode, validateAdvanceFundingInput, validatePersistedAdvanceFunding } from '../src/services/masterDataAdvanceFunding.ts'
import { classifyMasterCandidate } from '../src/services/masterDataClassification.ts'
import { createMasterDataProjectGateFixture } from './fixtures/masterDataProjectGateFixture.ts'
import { isProjectGateReady } from '../src/services/masterDataProjectGate.ts'

const fixture = createMasterDataProjectGateFixture()
const candidate = fixture.candidates[0]
const source = fixture.evidence[candidate.id]
const input = {
  senderName: source.transferSenderName ?? 'บริษัททดสอบ จำกัด',
  senderAccountLast4: source.transferSenderAccountLast4 ?? '1614',
  senderBankName: source.transferSenderBank ?? 'ธนาคารต้นทาง',
  recipientName: source.transferRecipientName ?? candidate.display_name,
  recipientAccountLast4: source.transferRecipientAccountLast4 ?? String(candidate.candidate_data.account_last4),
  recipientBankName: source.transferRecipientBank ?? 'ธนาคารทดสอบ',
  classificationType: 'employee_technician',
  reason: 'เติมเงินทดลองจ่าย',
}

assert.equal(isProjectGateReady(candidate), false, 'ordinary Project-first candidate must remain blocked')
assert.equal(inferMasterRecordingMode(candidate), 'project_scoped')
assert.equal(inferMasterRecordingMode({ candidate_data: { transaction_purpose: 'advance_transfer' } }), 'employee_advance_funding')
assert.equal(inferMasterRecordingMode({ candidate_data: { expense_type: 'advance' } }), 'employee_advance_funding')
assert.deepEqual(validateAdvanceFundingInput(candidate, source, input), { valid: true, blockers: [] })
assert.ok(validateAdvanceFundingInput(candidate, source, { ...input, reason: '' }).blockers.includes('เหตุผลอย่างน้อย 3 ตัวอักษร'))
assert.ok(validateAdvanceFundingInput(candidate, { ...source, transferAmount: null }, input).blockers.includes('ยอดโอนที่มากกว่า 0'))
assert.ok(validateAdvanceFundingInput(candidate, source, { ...input, classificationType: 'vendor' }).blockers.includes('ประเภทต้องเป็น Employee/Technician'))
assert.ok(validateAdvanceFundingInput(candidate, source, { ...input, senderName: '' }).blockers.includes('ชื่อผู้โอน/แหล่งเงิน'))
assert.ok(validateAdvanceFundingInput(candidate, source, { ...input, senderAccountLast4: '' }).blockers.includes('เลขท้ายบัญชีผู้โอนอย่างน้อย 4 หลัก'))
assert.ok(validateAdvanceFundingInput(candidate, source, { ...input, recipientName: '' }).blockers.includes('ชื่อผู้รับ/ผู้ถือเงิน'))

const result = applyLocalAdvanceFunding(candidate, source, input, '2026-08-26T05:30:00.000Z', 'fixture-advance-funding-1')
assert.equal(result.candidate?.status, 'confirmed')
assert.equal(result.candidate?.classification_type, 'employee_technician')
assert.equal(classifyMasterCandidate(result.candidate!, source).type, 'employee_technician', 'confirmed report must render Employee/Technician from the persisted classification')
assert.equal(result.candidate?.candidate_data.business_flow, 'employee_advance_funding')
assert.equal(result.candidate?.candidate_data.project_gate_resolution, 'not_required_advance_funding')
assert.equal(result.candidate?.candidate_data.project_allocation_status, 'awaiting_allocation')
assert.equal(result.candidate?.candidate_data.bank_name, input.recipientBankName)
assert.equal(result.candidate?.candidate_data.sender_classification, 'company_internal')
assert.equal(result.candidate?.candidate_data.recipient_classification, 'employee_technician')
assert.equal(result.candidate?.candidate_data.transfer_party_review_status, 'confirmed')
assert.equal(result.party_review?.sender_review_status, 'confirmed')
assert.equal(result.party_review?.recipient_review_status, 'confirmed')
assert.equal(result.sender_bank_account?.owner_type, 'other')
assert.equal(result.recipient_bank_account?.owner_type, 'employee')
assert.equal(result.accounting_task?.department, 'accounting')
assert.equal(result.lineage?.purpose_type, 'advance_transfer')
assert.equal(result.lineage?.route_status, 'accounting_review')
assert.equal(result.lineage?.next_destination, 'advance_finance')
assert.equal(result.lineage?.project_id, null)
assert.equal(validatePersistedAdvanceFunding(candidate.id, result, result.candidate ?? null), null)
assert.match(validatePersistedAdvanceFunding(candidate.id, { ...result, accounting_task: undefined }, result.candidate ?? null) ?? '', /Accounting Pending Task/)

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const drawer = readFileSync('src/pages/MasterDataCenter/MasterDataReviewDrawer.tsx', 'utf8')
const panel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')
const actions = readFileSync('src/pages/MasterDataCenter/MasterDataReviewWorkflow.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260826190500_master_data_employee_advance_funding.sql', 'utf8')
const partyMigration = readFileSync('supabase/migrations/20260826223000_master_data_transfer_party_review.sql', 'utf8')

for (const token of ['confirm_master_data_employee_advance_funding_v2', 'validatePersistedAdvanceFunding', 'await load()', 'Accounting Pending Queue']) assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const token of ['เงินเบิกล่วงหน้า/เงินสำรองจ่ายให้พนักงาน', 'ยืนยันบัญชี 2 ฝั่ง', 'เลือกและตรวจ 2 ฝั่ง', 'ไม่บังคับ Project', 'Accounting Pending Queue → Advance Finance', 'ไม่สร้าง Project Candidate ปลอม', 'Company/Internal', 'Employee/Technician', 'ตรวจและเก็บทั้งสองฝั่ง']) assert.match(panel + drawer, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const token of ['ยืนยันผู้โอน–ผู้รับ และส่งบัญชี', 'Project รอจัดสรร']) assert.match(actions + drawer, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(panel + drawer, /บทบาทเพิ่มเติม/)
for (const token of [
  "set search_path = ''", 'master_advance_event_key_required', 'master_advance_reason_required',
  'target_display_name text default null', 'target_account_last4 text default null', 'target_bank_name text default null',
  "source_row.source_table <> 'financial_transactions'", "transaction_row.review_status in ('duplicate','dismissed')",
  "'candidate_confirm_employee_advance_funding'", "'project_allocation_status','awaiting_allocation'",
  "'accounting'", "'advance_transfer'", "'accounting_review'", "'advance_finance'",
  'master_data_candidate_versions', 'master_data_audit', 'document_flow_events',
  'on conflict(item_id,department)', 'on conflict(item_id)', 'revoke all on function', 'grant execute on function',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(migration, /delete from public\.(master_data_candidates|financial_transactions|document_flow_items|line_messages|master_data_audit)/i)
assert.match(migration, /is_verified_advance_funding/)
assert.match(migration, /master_candidate_project_gate_required/)

for (const token of [
  'master_data_transfer_party_reviews', 'confirm_master_data_employee_advance_funding_v2',
  "'company_internal'", "'employee_technician'", 'sender_master_bank_account_id',
  'recipient_master_bank_account_id', 'candidate_confirm_transfer_parties_advance_funding',
  'master_data_candidate_versions', 'master_data_audit', 'document_flow_events',
  "set search_path = ''", 'revoke all on function', 'grant execute on function',
]) assert.match(partyMigration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(partyMigration, /update public\.financial_transactions set/i)
assert.doesNotMatch(partyMigration, /delete from public\./i)

console.log('master-data advance funding passed: sender Company/Internal + recipient Employee/Technician persist as one audited pair → Accounting first → Advance Finance')
