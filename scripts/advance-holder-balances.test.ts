import assert from 'node:assert/strict'
import { calculateHolderBalance, type HolderAdvanceCase } from '../src/pages/AdvanceHolders/advanceHolderBalances.ts'
const cases: HolderAdvanceCase[] = [{ id: 'case-1', advance_number: 'ADV-001', holder_profile_id: 'profile-1', holder_person_id: null, amount_received: 1_000, status: 'approved', updated_at: '2026-08-31T02:00:00Z', financial_transactions: { transfer_at: '2026-08-31T01:00:00Z' }, employee_advance_settlement_items: [{ expense_type: 'materials', amount: 700, approval_status: 'approved' }, { expense_type: 'cash_return', amount: 200, approval_status: 'approved' }, { expense_type: 'travel', amount: 150, approval_status: 'submitted' }] }]
const result = calculateHolderBalance(cases)
assert.deepEqual({ received: result.received, paid: result.paidOrOffset, returned: result.returned, balance: result.balance, pending: result.pendingAmount, pendingCount: result.pendingCount }, { received: 1_000, paid: 700, returned: 200, balance: 100, pending: 150, pendingCount: 1 })
const negative = calculateHolderBalance([{ ...cases[0], employee_advance_settlement_items: [{ expense_type: 'materials', amount: 1_100, approval_status: 'approved' }] }])
assert.equal(negative.balance, -100)
console.log('advance holder balances contract passed')
