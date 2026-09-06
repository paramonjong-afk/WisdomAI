import assert from 'node:assert/strict'
import { buildSlipAnalysisGate, inferSlipMoneyPurpose, isSuspiciousTransferDate, slipPurposeNeedsFundHolder, slipPurposeNeedsProject } from '../src/services/transferSlipAnalysisGate.ts'
import { emptyMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'
import type { TransferSlipQueueRow } from '../src/services/accountingTransferSlipQueue.ts'
import { readFileSync } from 'node:fs'

const row = (overrides: Partial<TransferSlipQueueRow> = {}): TransferSlipQueueRow => ({
  taskId: 'task-1', itemId: 'item-1', intakeId: 'intake-1', sourceMessageId: 'message-1', createdAt: '2026-08-27T00:00:00Z', taskStatus: 'pending',
  senderName: 'บริษัท ทดสอบ', recipientName: 'นายช่าง ทดสอบ', amount: 1200, transferAt: '2026-08-27T07:00:00Z', reviewStatus: 'pending', route: 'accounting',
  sourceChannel: 'webchat', sourceRoomName: 'บัญชี', sourceSenderName: 'Admin', sourceReceivedAt: '2026-08-27T07:01:00Z', dataReviewStatus: 'complete', dataReviewNote: null,
  candidateDepartments: [], expenseType: null, laborAmount: null, duplicateOf: null, transactionId: 'tx-1', senderBankName: 'KBank', senderAccountLast4: '1111',
  recipientBankName: 'SCB', recipientAccountLast4: '2222', bankReference: 'REF-1', paymentPartyConfidence: .97, analysisConfidence: .95, analysisModel: 'fixture', notes: null,
  truthStatus: 'needs_review', isPostable: false, canonicalPayerName: null, canonicalFundHolderName: null, canonicalBeneficiaryName: null, canonicalAmount: null,
  ...overrides,
})

assert.equal(inferSlipMoneyPurpose(row({ candidateDepartments: ['payroll'] })).purpose, 'payroll')
assert.equal(inferSlipMoneyPurpose(row({ candidateDepartments: ['advance_finance'] })).purpose, 'advance_transfer')
assert.equal(inferSlipMoneyPurpose(row({ expenseType: 'จ่ายผู้ขาย' })).purpose, 'vendor_payment')
assert.equal(inferSlipMoneyPurpose(row({ notes: 'ซื้อวัสดุหน้างาน' })).purpose, 'materials')
assert.equal(inferSlipMoneyPurpose(row({ notes: 'คืนเงินสำรอง' })).purpose, 'refund_return')
assert.equal(inferSlipMoneyPurpose(row()).purpose, 'unknown')

const draft = emptyMoneyLineage('บริษัท ทดสอบ', 'นายช่าง ทดสอบ', 1200, '2026-08-27T07:00')
draft.fundingSourceType = 'company_account'
draft.allocations[0].purposeType = 'advance_transfer'
draft.allocations[0].confidence = '.95'
const ready = buildSlipAnalysisGate(row({ candidateDepartments: ['advance_finance'] }), draft)
assert.equal(ready.purpose, 'advance_transfer')
assert.equal(ready.destination, 'บัญชี → กองเงินผู้ถือเงิน')
assert.equal(ready.state, 'ready_to_confirm')
assert.equal(ready.blockers.length, 0)

const routed = buildSlipAnalysisGate(row({ candidateDepartments: ['advance_finance'], truthStatus: 'confirmed', isPostable: true }), draft)
assert.equal(routed.state, 'auto_routed')
assert.equal(isSuspiciousTransferDate('3112-08-29T00:00:00Z', new Date('2026-08-31T00:00:00Z')), true)
const invalidDate = buildSlipAnalysisGate(row({ candidateDepartments: ['advance_finance'], truthStatus: 'confirmed', isPostable: true, transferAt: '3112-08-29T00:00:00Z' }), draft)
assert.equal(invalidDate.state, 'needs_confirmation')
assert.ok(invalidDate.blockers.includes('วันที่ผิดปกติ ต้องตรวจจากสลิป'))
const blocked = buildSlipAnalysisGate(row({ senderAccountLast4: null, recipientName: null, amount: null }), null)
assert.ok(blocked.blockers.includes('ยืนยันบัญชีผู้โอน'))
assert.ok(blocked.blockers.includes('ยืนยันผู้รับ'))
assert.ok(blocked.blockers.includes('ยืนยันยอดเงิน'))
assert.ok(blocked.blockers.includes('ยืนยันประเภทเงิน'))
assert.equal(slipPurposeNeedsProject('materials'), true)
assert.equal(slipPurposeNeedsProject('advance_transfer'), false)
assert.equal(slipPurposeNeedsFundHolder('advance_transfer'), true)
const accountingPage = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const advancePartyMigration = readFileSync('supabase/migrations/20260827003009_transfer_slip_advance_party_auto_link.sql', 'utf8')
assert.match(accountingPage, /จ่ายผู้ขายผ่านบัญชีบุคคล \(เงินสำรองจ่าย\)/)
assert.match(accountingPage, /resolve_transfer_slip_advance_parties/)
assert.match(accountingPage, /ตรวจข้อมูล 2 ฝั่ง · เงินเบิกล่วงหน้า/)
assert.match(accountingPage, /กลับไปเส้นเงินเดิม/)
assert.match(accountingPage, /startsWith\('\/advance-holders'\)/)
assert.match(advancePartyMigration, /transfer_slip_advance_party_links/)
assert.match(advancePartyMigration, /sender_bank_account_owner_conflict/)
assert.match(advancePartyMigration, /recipient_bank_account_owner_conflict/)
assert.match(advancePartyMigration, /on conflict\(company_id,financial_transaction_id\)/)
assert.match(advancePartyMigration, /transfer_slip_advance_parties_linked/)

console.log('transfer slip analysis gate passed: type-aware fields, explicit blockers and confirmed auto-route state')
