import assert from 'node:assert/strict'
import { calculateHolderBalance, type HolderAdvanceCase } from '../src/pages/AdvanceHolders/advanceHolderBalances.ts'

const cases: HolderAdvanceCase[] = [{
  id: 'case-1', advance_number: 'ADV-001', holder_profile_id: 'profile-1', holder_person_id: null,
  amount_received: 1_000, status: 'approved', updated_at: '2026-08-31T02:00:00Z', financial_transactions: { transfer_at: '2026-08-31T01:00:00Z' },
  employee_advance_settlement_items: [
    { expense_type: 'materials', amount: 700, approval_status: 'approved' },
    { expense_type: 'cash_return', amount: 200, approval_status: 'approved' },
    { expense_type: 'travel', amount: 150, approval_status: 'submitted' },
  ],
}]

const result = calculateHolderBalance(cases)
assert.equal(result.received, 1_000)
assert.equal(result.paidOrOffset, 700)
assert.equal(result.returned, 200)
assert.equal(result.balance, 100)
assert.equal(result.pendingAmount, 150)
assert.equal(result.pendingCount, 1)

const negative = calculateHolderBalance([{ ...cases[0], employee_advance_settlement_items: [{ expense_type: 'materials', amount: 1_100, approval_status: 'approved' }] }])
assert.equal(negative.balance, -100, 'ยอดจ่ายเกินยอดรับต้องคงเป็นค่าติดลบเพื่อให้ UI แจ้งเตือน')

console.log('advance holder balances contract passed')
