import assert from 'node:assert/strict'
import { findSupportingBillMatches, type SupportingBillDocument } from '../src/services/supportingBillMatch.ts'

const document = (id: string, amount: number, patch: Partial<SupportingBillDocument> = {}): SupportingBillDocument => ({
  id,
  documentSetId: null,
  documentType: 'receipt',
  documentNumber: id,
  documentDate: '2026-08-28',
  vendorName: `ร้าน ${id}`,
  totalAmount: amount,
  status: 'confirmed',
  projectId: null,
  ...patch,
})

const matches = findSupportingBillMatches(588, '2026-08-28T16:06:00+07:00', [
  document('exact', 588),
  document('part-a', 170),
  document('part-b', 218),
  document('part-c', 200),
  document('slip', 588, { documentType: 'transfer_slip' }),
  document('duplicate', 588, { status: 'duplicate' }),
  document('old', 588, { documentDate: '2026-01-01' }),
  document('undated', 588, { documentDate: null, status: 'pending' }),
])

assert.equal(matches[0].kind, 'exact')
assert.deepEqual(matches[0].documents.map((item) => item.id), ['exact'])
assert.equal(matches.some((match) => match.documents.map((item) => item.id).sort().join(',') === 'part-a,part-b,part-c'), true)
assert.equal(matches.some((match) => match.documents.some((item) => ['slip', 'duplicate', 'old'].includes(item.id))), false)
assert.equal(matches.some((match) => match.documents.some((item) => item.id === 'undated')), true)

const documentSetMatches = findSupportingBillMatches(300, '2026-08-28T16:06:00+07:00', [
  document('page-1', 300, { documentSetId: 'set-1' }),
  document('page-2', 300, { documentSetId: 'set-1' }),
])
assert.equal(documentSetMatches.length, 1)
assert.deepEqual(documentSetMatches[0].documents.map((item) => item.id), ['page-1'])
assert.deepEqual(findSupportingBillMatches(null, null, [document('unused', 100)]), [])

console.log('supporting bill amount matching contract: PASS')
