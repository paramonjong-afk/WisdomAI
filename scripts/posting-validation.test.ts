import assert from 'node:assert/strict'
import { validatePosting } from '../src/services/postingValidation.ts'

const base = {
  companyId: 'company-1', actorRole: 'accounting', eventKey: 'posting:event-1', expectedVersion: 2, actualVersion: 2,
  truthStatus: 'confirmed' as const, isPostable: true, documentStatus: 'confirmed', periodStatus: 'open' as const,
  documentTotal: 107, lineTotal: 100, taxTotal: 7, lines: [{ debit: 107, credit: 0 }, { debit: 0, credit: 107 }],
  purchaseOrderRemaining: 200, receiptRemaining: 200, requestedAmount: 107, availableBalance: 200,
}

assert.equal(validatePosting(base).allowed, true)
assert.deepEqual(validatePosting({ ...base, truthStatus: 'duplicate' }).blockers, ['canonical_truth_not_postable'])
assert.ok(validatePosting({ ...base, periodStatus: 'closed' }).blockers.includes('period_locked'))
assert.ok(validatePosting({ ...base, expectedVersion: 3 }).blockers.includes('stale_version'))
assert.ok(validatePosting({ ...base, lines: [{ debit: 106, credit: 0 }, { debit: 0, credit: 107 }] }).blockers.includes('debit_credit_imbalance'))
assert.ok(validatePosting({ ...base, requestedAmount: 201, purchaseOrderRemaining: 200 }).blockers.includes('purchase_order_overage'))
assert.ok(validatePosting({ ...base, actorRole: 'viewer' }).blockers.includes('posting_role_not_allowed'))
assert.equal(validatePosting({ ...base, eventKey: '' }).allowed, false)

console.log('posting final validation and balance contracts passed')
