import assert from 'node:assert/strict'
import { hasResolvedMoneyRoute, matchAdvanceHolderSlips, normalizeAdvanceHolderName } from '../src/services/advanceHolderSlipMatch.ts'

assert.equal(normalizeAdvanceHolderName('นาย ทวีชัย ภรามร'), 'ทวีชัยภรามร')
assert.equal(normalizeAdvanceHolderName('น.ส. จิรภรณ์ พริกสุวรรณ์'), 'จิรภรณ์พริกสุวรรณ์')
assert.equal(hasResolvedMoneyRoute({ transactionId: 'route-1', itemId: 'item-route-1', senderName: 'บริษัท', recipientName: 'ผู้ถือเงิน', amount: 100, transferAt: null, truthStatus: 'confirmed', duplicateOf: null, lineageId: 'lineage-1', purposeType: 'advance_transfer', routeStatus: 'routed', nextDestination: 'advance_finance' }), true)
assert.equal(hasResolvedMoneyRoute({ transactionId: 'route-2', itemId: 'item-route-2', senderName: 'บริษัท', recipientName: 'ผู้ถือเงิน', amount: 100, transferAt: null, truthStatus: 'needs_review', duplicateOf: null, lineageId: null, purposeType: 'unknown', routeStatus: 'draft', nextDestination: null }), false)

const holders = [
  { id: 'holder-1', displayName: 'ทวีชัย ภรามร', aliases: ['นาย ทวีชัย ภรามร', 'ทวีศักดิ์ ภรามร'] },
  { id: 'holder-2', displayName: 'จิรภรณ์ พริกสุวรรณ์', aliases: [] },
]

const matches = matchAdvanceHolderSlips(holders, [
  { transactionId: 'tx-1', itemId: 'item-1', senderName: 'บริษัท ก', recipientName: 'นาย ทวีชัย ภรามร', amount: 500, transferAt: '2026-08-30T10:00:00Z', truthStatus: 'confirmed', duplicateOf: null },
  { transactionId: 'tx-2', itemId: 'item-2', senderName: 'ทวีศักดิ์ ภรามร', recipientName: 'ร้านค้า', amount: 200, transferAt: '2026-08-31T10:00:00Z', truthStatus: 'needs_review', duplicateOf: null },
  { transactionId: 'tx-3', itemId: 'item-3', senderName: 'จิรภรณ์ พริกสุวรรณ์', recipientName: 'ทวีชัย ภรามร', amount: 100, transferAt: '2026-08-29T10:00:00Z', truthStatus: 'confirmed', duplicateOf: null },
  { transactionId: 'tx-4', itemId: 'item-4', senderName: 'ทวีชัย ภรามร', recipientName: 'ร้านค้า', amount: 70, transferAt: '2026-08-28T10:00:00Z', truthStatus: 'duplicate', duplicateOf: 'tx-original' },
  { transactionId: 'tx-5', itemId: 'item-5', senderName: 'ทวีชัย ภรามร', recipientName: 'ร้านค้า', amount: 80, transferAt: '2026-08-27T10:00:00Z', truthStatus: 'duplicate', duplicateOf: null },
])

assert.equal(matches.length, 4)
assert.equal(matches[0].direction, 'outgoing')
assert.equal(matches.filter((item) => item.direction === 'incoming').length, 2)
assert.equal(matches.filter((item) => item.direction === 'outgoing').length, 2)
assert.equal(matches.some((item) => item.transactionId === 'tx-4'), false)
assert.equal(matches.some((item) => item.transactionId === 'tx-5'), false)
assert.equal(matches.every((item) => item.matchStatus === 'exact'), true)

console.log('advance holder slip matching contract: PASS')
