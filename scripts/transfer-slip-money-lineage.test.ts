import assert from 'node:assert/strict'
import { calculateUnallocatedAmount, emptyMoneyAllocation, emptyMoneyLineage, legacyMoneyLineageScope, moneyAllocationDestinations, moneyAllocationTotal, moneyPurposeRoute, validateMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'

const draft = emptyMoneyLineage('บริษัท', 'นาย ก', 10000, '2026-08-23T10:00')
draft.fundingSourceType = 'reserve_fund'
draft.fundHolderName = 'นาย ก'
draft.startingAmount = '50000'
draft.returnedAmount = '0'
draft.allocations = [{ ...draft.allocations[0], purposeType: 'materials', projectId: 'project-1', amount: '6000' }, { ...emptyMoneyAllocation(4000, 'ช่าง ก'), purposeType: 'payroll' }]
draft.remainingAmount = calculateUnallocatedAmount(10000, draft.allocations, draft.returnedAmount)
assert.deepEqual(validateMoneyLineage(draft, 10000), { missing: [], errors: [] })
assert.equal(moneyAllocationTotal(draft.allocations), 10000)
assert.deepEqual(moneyAllocationDestinations(draft.allocations), ['บัญชี → ต้นทุนโครงการ', 'บัญชี → HR/ค่าแรง'])
assert.deepEqual(moneyPurposeRoute('materials').departments, ['project'])
assert.equal(moneyPurposeRoute('payroll').route, 'บัญชี → HR/ค่าแรง')
assert.deepEqual(legacyMoneyLineageScope(draft.allocations), { projectId: 'project-1', siteId: '' })
draft.paidAmount = '9000'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดจ่ายไม่ตรง/)
draft.paidAmount = '10000'; draft.allocations[1].amount = '3000'; draft.remainingAmount = '0'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดสลิปไม่เท่ากับ/)
draft.allocations = [{ ...draft.allocations[0], purposeType: 'advance_transfer', amount: '6000' }, { ...draft.allocations[1], purposeType: 'materials', amount: '4000' }]
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ต้องเป็นสลิปเฉพาะรายการ/)
console.log('transfer slip money lineage contract: PASS')
