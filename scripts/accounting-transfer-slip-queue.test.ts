import assert from 'node:assert/strict'
import { filterTransferSlipQueue, transferSlipContinuation, transferSlipQueueCounts } from '../src/services/accountingTransferSlipQueue.ts'
import type { TransferSlipQueueRow } from '../src/services/accountingTransferSlipQueue.ts'

const row = (overrides: Partial<TransferSlipQueueRow> = {}): TransferSlipQueueRow => ({
  taskId: crypto.randomUUID(), itemId: crypto.randomUUID(), intakeId: crypto.randomUUID(), sourceMessageId: crypto.randomUUID(), createdAt: '2026-08-23T08:00:00Z', taskStatus: 'queued',
  senderName: 'ผู้โอน', recipientName: 'ผู้รับ', amount: 1200, transferAt: '2026-08-23T07:30:00Z', reviewStatus: 'pending', route: 'accounting',
  sourceChannel: 'line', sourceRoomName: 'ห้องทดสอบ', sourceSenderName: 'ผู้ส่ง', sourceReceivedAt: '2026-08-23T08:00:00Z', dataReviewStatus: 'complete', dataReviewNote: null,
  candidateDepartments: ['accounting'], expenseType: null, laborAmount: null, duplicateOf: null,
  transactionId: crypto.randomUUID(), senderBankName: 'ธนาคาร ก', senderAccountLast4: '1234', recipientBankName: 'ธนาคาร ข', recipientAccountLast4: '5678', bankReference: 'REF-001', paymentPartyConfidence: .95, analysisConfidence: .94, analysisModel: 'fixture', notes: null,
  truthStatus: 'needs_review', isPostable: false, canonicalPayerName: null, canonicalFundHolderName: null, canonicalBeneficiaryName: null, canonicalAmount: null,
  partyIdentityStatus: 'unconfirmed', confirmedPartyPayerName: null, confirmedPartyBeneficiaryName: null, partyIdentitySourceLineageId: null, partyIdentityConfirmedAt: null, ...overrides,
})

const fixture = [
  row(),
  row({ taskStatus: 'completed', reviewStatus: 'confirmed', truthStatus: 'confirmed', isPostable: true, canonicalPayerName: 'ผู้จ่ายจริง', canonicalBeneficiaryName: 'ผู้รับจริง', canonicalAmount: 1200 }),
  row({ reviewStatus: 'duplicate', duplicateOf: crypto.randomUUID() }),
  row({ senderName: null, dataReviewStatus: 'incomplete' }),
]

const counts = transferSlipQueueCounts(fixture)
assert.deepEqual(counts, { transfer_slip: 3, pending: 1, reviewed: 1, duplicate: 1, incomplete: 1 })
assert.equal(filterTransferSlipQueue(fixture, 'transfer_slip').some(item => item.reviewStatus === 'duplicate'), false)
assert.equal(filterTransferSlipQueue(fixture, 'incomplete')[0]?.dataReviewStatus, 'incomplete')
assert.deepEqual(transferSlipContinuation(row({ candidateDepartments: ['accounting', 'advance_finance'] })), { label: 'เบิกล่วงหน้า', route: 'บัญชี → เงินสำรองจ่าย' })
assert.deepEqual(transferSlipContinuation(row({ candidateDepartments: ['accounting', 'payroll'] })), { label: 'ค่าแรง', route: 'บัญชี → ค่าแรง' })
assert.equal(transferSlipContinuation(row()).route, 'บัญชีตรวจสอบ')

console.log('accounting transfer-slip queue contract: PASS')
