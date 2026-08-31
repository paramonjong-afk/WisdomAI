import assert from 'node:assert/strict'
import { calculateHolderBalance, type HolderAdvanceCase } from '../src/pages/AdvanceHolders/advanceHolderBalances.ts'
const cases: HolderAdvanceCase[] = [{ id: 'case-1', advance_number: 'ADV-001', financial_transaction_id: 'tx-in-1', holder_profile_id: 'profile-1', holder_person_id: null, amount_received: 1_000, status: 'approved', updated_at: '2026-08-31T02:00:00Z', financial_transactions: { transfer_at: '2026-08-31T01:00:00Z' }, employee_advance_settlement_items: [{ expense_type: 'materials', amount: 700, approval_status: 'approved', evidence_flow_item_id: 'item-out-1' }, { expense_type: 'cash_return', amount: 200, approval_status: 'approved', evidence_flow_item_id: null }, { expense_type: 'travel', amount: 150, approval_status: 'submitted', evidence_flow_item_id: 'item-pending' }] }]
const result = calculateHolderBalance(cases)
assert.deepEqual({ received: result.received, paid: result.paidOrOffset, returned: result.returned, balance: result.balance, pending: result.pendingAmount, pendingCount: result.pendingCount }, { received: 1_000, paid: 700, returned: 200, balance: 100, pending: 150, pendingCount: 1 })
const negative = calculateHolderBalance([{ ...cases[0], employee_advance_settlement_items: [{ expense_type: 'materials', amount: 1_100, approval_status: 'approved', evidence_flow_item_id: null }] }])
assert.equal(negative.balance, -100)
const excluded = calculateHolderBalance([...cases, { ...cases[0], id: 'case-cancelled', financial_transaction_id: 'tx-cancelled', amount_received: 300, status: 'cancelled' }, { ...cases[0], id: 'case-rejected', financial_transaction_id: 'tx-rejected', amount_received: 70, status: 'rejected' }])
assert.deepEqual({ received: excluded.received, excludedAmount: excluded.excludedAmount, excludedCount: excluded.excludedCount, cases: excluded.cases.length }, { received: 1_000, excludedAmount: 370, excludedCount: 2, cases: 1 })
assert.deepEqual(excluded.postedIncomingTransactionIds, ['tx-in-1'])
assert.deepEqual(excluded.postedOutgoingItemIds, ['item-out-1'])
console.log('advance holder balances contract passed')
