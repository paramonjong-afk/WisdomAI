import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateHolderRealtimeBalance } from '../src/pages/AdvanceHolders/advanceHolderRealtime.ts'
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
  { ...base, id: 'tx-3:incoming', transactionId: 'tx-3', holderId: 'holder-1', direction: 'incoming', amount: 1000, transferAt: '2026-08-31T07:00:00Z', truthStatus: 'confirmed' } as AdvanceHolderSlipMatch,
  { ...base, id: 'tx-4:outgoing', transactionId: 'tx-4', holderId: 'holder-2', direction: 'outgoing', amount: 999, transferAt: '2026-08-31T10:00:00Z', truthStatus: 'confirmed' } as AdvanceHolderSlipMatch,
]

const result = calculateHolderRealtimeBalance('holder-1', 1_500, movements)
assert.equal(result.realtimePaid, 600)
assert.equal(result.inTransit, 200)
assert.equal(result.projectedBalance, 900)
assert.equal(result.confirmedBalance, 1_500)
assert.equal(result.variance, -600)
assert.equal(result.reviewCount, 1)
assert.equal(result.reviewAmount, 200)
assert.equal(result.lastActivityAt, '2026-08-31T09:00:00Z')
assert.equal(result.movements.length, 3)

const page = readFileSync(new URL('../src/pages/AdvanceHolders/index.tsx', import.meta.url), 'utf8')
for (const label of ['จ่ายออก Real-time', 'เงินกำลังเดินทาง', 'คงเหลือคาดการณ์', 'คงเหลือยืนยัน', 'ผลต่าง/รอตรวจ', 'เส้นเงินล่าสุด']) assert.match(page, new RegExp(label))
for (const filter of ['มียอดคงเหลือ', 'รอตรวจ', 'ยอดติดลบ', 'ไม่มีการเคลื่อนไหว']) assert.match(page, new RegExp(filter))
assert.match(page, /scanSlips\(false\)/)
assert.match(page, /เปิดสลิป\/Audit/)
assert.doesNotMatch(page, /รับเข้ารวม|จ่ายออกรวม|คงเหลือรวม|ยอดรอตรวจ/)

console.log('advance holder realtime contract passed')
