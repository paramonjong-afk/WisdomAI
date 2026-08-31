import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateHolderRealtimeBalance, movementReviewReasons } from '../src/pages/AdvanceHolders/advanceHolderRealtime.ts'
import type { AdvanceHolderSlipMatch } from '../src/services/advanceHolderSlipMatch.ts'

const base = {
  itemId: 'item-1', holderName: 'ทวีศักดิ์ ภรามร', senderName: null, recipientName: null,
  matchStatus: 'exact', matchedName: 'ทวีศักดิ์ ภรามร', lineageId: 'lineage-1', fundingSourceType: 'company',
  purposeType: 'materials', routeStatus: 'routed', nextDestination: 'project', canonicalPayerName: null,
  canonicalFundHolderName: 'ทวีศักดิ์ ภรามร', canonicalBeneficiaryName: null, routeResolved: true,
} satisfies Partial<AdvanceHolderSlipMatch>

const movements: AdvanceHolderSlipMatch[] = [
  { ...base, id: 'tx-1:outgoing', transactionId: 'tx-1', holderId: 'holder-1', direction: 'outgoing', amount: 400, transferAt: '2026-08-31T08:00:00Z', truthStatus: 'confirmed' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-2:outgoing', transactionId: 'tx-2', holderId: 'holder-1', direction: 'outgoing', amount: 200, transferAt: '2026-08-31T09:00:00Z', truthStatus: 'needs_review', routeStatus: null, nextDestination: null, routeResolved: false } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-3:incoming', transactionId: 'tx-3', holderId: 'holder-1', direction: 'incoming', amount: 1000, transferAt: '2026-08-31T07:00:00Z', truthStatus: 'confirmed', purposeType: 'advance_transfer' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-posted:incoming', transactionId: 'tx-posted', itemId: 'item-posted-in', holderId: 'holder-1', direction: 'incoming', amount: 500, transferAt: '2026-08-31T06:00:00Z', truthStatus: 'confirmed', purposeType: 'advance_transfer' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-posted-out:outgoing', transactionId: 'tx-posted-out', itemId: 'item-posted-out', holderId: 'holder-1', direction: 'outgoing', amount: 300, transferAt: '2026-08-31T05:00:00Z', truthStatus: 'confirmed' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-4:outgoing', transactionId: 'tx-4', holderId: 'holder-2', direction: 'outgoing', amount: 999, transferAt: '2026-08-31T10:00:00Z', truthStatus: 'confirmed' } as AdvanceHolderSlipMatch,
]

const result = calculateHolderRealtimeBalance('holder-1', 1_500, movements, ['tx-posted'], ['item-posted-out'])
assert.equal(result.realtimeReceived, 1000)
assert.equal(result.realtimePaid, 600)
assert.equal(result.inTransit, 200)
assert.equal(result.projectedBalance, 1900)
assert.equal(result.confirmedBalance, 1_500)
assert.equal(result.variance, 400)
assert.equal(result.reviewCount, 1)
assert.equal(result.reviewAmount, 200)
assert.equal(result.lastActivityAt, '2026-08-31T09:00:00Z')
assert.equal(result.movements.length, 5)
const borrowedFunding = calculateHolderRealtimeBalance('holder-borrowed', 0, [
  { ...base, id: 'tx-borrowed:incoming', transactionId: 'tx-borrowed', holderId: 'holder-borrowed', direction: 'incoming', amount: 208005.69, transferAt: '2026-08-31T10:00:00Z', truthStatus: 'confirmed', purposeType: 'materials', fundingSourceType: 'borrowed_funds' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-borrowed:outgoing', transactionId: 'tx-borrowed-out', holderId: 'holder-borrowed', direction: 'outgoing', amount: 208005.69, transferAt: '2026-08-31T11:00:00Z', truthStatus: 'confirmed', purposeType: 'materials' } as AdvanceHolderSlipMatch,
])
assert.equal(borrowedFunding.realtimeReceived, 208005.69)
assert.equal(borrowedFunding.projectedBalance, 0)
const productionLike = calculateHolderRealtimeBalance('holder-tawichai', 0, [
  { ...base, id: 'tx-5060:incoming', transactionId: 'tx-5060', holderId: 'holder-tawichai', direction: 'incoming', amount: 5060, transferAt: '2026-08-19T11:00:00Z', truthStatus: 'confirmed', purposeType: 'advance_transfer' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-3000:incoming', transactionId: 'tx-3000', holderId: 'holder-tawichai', direction: 'incoming', amount: 3000, transferAt: '2026-07-23T22:22:00Z', truthStatus: 'confirmed', purposeType: 'advance_transfer' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-500:outgoing', transactionId: 'tx-500', holderId: 'holder-tawichai', direction: 'outgoing', amount: 500, transferAt: '2026-08-01T22:15:00Z', truthStatus: 'confirmed', purposeType: 'subcontractor' } as AdvanceHolderSlipMatch,
])
assert.deepEqual({ received: productionLike.realtimeReceived, paid: productionLike.realtimePaid, projected: productionLike.projectedBalance }, { received: 8060, paid: 500, projected: 7560 })
assert.deepEqual(movementReviewReasons(movements[1], new Date('2026-08-31T00:00:00Z')), ['ข้อมูลสลิปยังไม่ยืนยัน', 'ขาดเส้นทางปลายทาง'])
assert.ok(movementReviewReasons({ ...movements[0], transferAt: '3112-08-29T00:00:00Z' }, new Date('2026-08-31T00:00:00Z')).includes('วันที่ผิดปกติ'))

const page = readFileSync(new URL('../src/pages/AdvanceHolders/index.tsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20260831084415_enable_advance_holder_realtime.sql', import.meta.url), 'utf8')
for (const label of ['รับเข้าบันทึกแล้ว', 'รับเข้า Real-time', 'จ่ายออก Real-time', 'เงินกำลังเดินทาง', 'คงเหลือคาดการณ์', 'คงเหลือบันทึกแล้ว', 'ผลต่าง/รอตรวจ', 'เส้นเงินล่าสุด']) assert.match(page, new RegExp(label))
assert.match(page, /postedIncomingTransactionIds/)
assert.match(page, /postedOutgoingItemIds/)
assert.match(page, /ไม่นับเคสยกเลิก\/Reject/)
for (const filter of ['มียอดคงเหลือ', 'รอตรวจ', 'ยอดติดลบ', 'ไม่มีการเคลื่อนไหว']) assert.match(page, new RegExp(filter))
for (const liveContract of ['advance-holder-live:', 'postgres_changes', 'transfer_slip_money_lineages', 'employee_advance_cases', 'employee_advance_settlement_items', 'document_flow_destination_tasks', '30_000', 'visibilitychange', 'อัปเดตล่าสุด', 'สำรอง: อัปเดตทุก 30 วินาที']) assert.match(page, new RegExp(liveContract))
assert.match(page, /setTimeout\(\(\) => void refreshAll\(\), 600\)/)
for (const table of ['employee_advance_holders', 'employee_advance_holder_aliases', 'employee_advance_cases', 'employee_advance_settlement_items', 'financial_transactions', 'transfer_slip_money_lineages', 'document_flow_destination_tasks']) assert.match(migration, new RegExp(table))
assert.match(migration, /pg_publication_tables/)
assert.match(migration, /alter publication supabase_realtime add table/)
assert.match(page, /เปิดสลิป\/Audit/)
for (const action of ['แก้จุดที่ขาด', 'แก้ประเภทเงิน', 'ตรวจเส้นเงิน', 'return_to']) assert.match(page, new RegExp(action))
for (const destinationDetail of ['project_id,site_id', 'โครงการ ', 'ไซต์ ', 'รอโครงการตรวจต้นทุน', 'ยังไม่ใช่รายการบัญชี Final']) assert.match(page, new RegExp(destinationDetail))
assert.doesNotMatch(page, /รับเข้ารวม|จ่ายออกรวม|คงเหลือรวม|ยอดรอตรวจ/)

console.log('advance holder realtime contract passed')
