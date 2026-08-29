import assert from 'node:assert/strict'
import { applyMoneyFundingSource, calculateUnallocatedAmount, emptyMoneyAllocation, emptyMoneyLineage, legacyMoneyLineageScope, moneyAllocationDestinations, moneyAllocationTotal, moneyFundingSourceNeedsHolder, moneyPurposeRoute, validateMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'

const draft = emptyMoneyLineage('บริษัท', 'นาย ก', 10000, '2026-08-23T10:00')
draft.fundingSourceType = 'reserve_fund'
draft.fundHolderName = 'นาย ก'
draft.startingAmount = '50000'
draft.returnedAmount = '0'
draft.allocations = [{ ...draft.allocations[0], purposeType: 'materials', projectId: 'project-1', amount: '6000' }, { ...emptyMoneyAllocation(4000, 'ช่าง ก'), purposeType: 'payroll' }]
draft.allocations[0] = { ...draft.allocations[0], costCategoryId: 'category-materials', accountCode: '5101', accountName: 'วัสดุงานโครงสร้าง' }
draft.allocations[1].payrollKind = 'daily_wage'
draft.allocations[1] = { ...draft.allocations[1], costCategoryId: 'category-wage', accountCode: '5201', accountName: 'ค่าแรงและเงินเดือนโครงการ' }
draft.remainingAmount = calculateUnallocatedAmount(10000, draft.allocations, draft.returnedAmount)
assert.deepEqual(validateMoneyLineage(draft, 10000), { missing: [], errors: [] })
assert.equal(moneyAllocationTotal(draft.allocations), 10000)
assert.deepEqual(moneyAllocationDestinations(draft.allocations), ['บัญชี → ต้นทุนโครงการ', 'บัญชี → HR/ค่าแรงรายวัน'])
assert.deepEqual(moneyPurposeRoute('materials').departments, ['project'])
assert.equal(moneyPurposeRoute('payroll', 'salary').route, 'บัญชี → HR/เงินเดือน')
assert.deepEqual(legacyMoneyLineageScope(draft.allocations), { projectId: 'project-1', siteId: '' })
draft.paidAmount = '9000'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดจ่ายไม่ตรง/)
draft.paidAmount = '10000'; draft.allocations[1].amount = '3000'; draft.remainingAmount = '0'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดสลิปไม่เท่ากับ/)
draft.allocations = [{ ...draft.allocations[0], purposeType: 'advance_transfer', amount: '6000' }, { ...draft.allocations[1], purposeType: 'materials', amount: '4000' }]
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ต้องเป็นสลิปเฉพาะรายการ/)

const missingAccount = emptyMoneyLineage('บริษัท', 'พนักงาน', 500)
missingAccount.fundingSourceType = 'company_account'
missingAccount.allocations[0].purposeType = 'general_expense'
assert.match(validateMoneyLineage(missingAccount, 500).missing.join(' '), /บัญชีค่าใช้จ่ายรายการที่ 1/)

const payrollFromAdvance = emptyMoneyLineage('ผู้ถือเงินที่ยืนยัน', 'ช่างที่ยืนยัน', 1350)
payrollFromAdvance.allocations[0].purposeType = 'payroll'
payrollFromAdvance.allocations[0].payrollKind = 'salary'
const fundedPayroll = applyMoneyFundingSource(payrollFromAdvance, 'employee_advance')
assert.equal(moneyFundingSourceNeedsHolder('employee_advance'), true)
assert.equal(fundedPayroll.fundHolderName, 'ผู้ถือเงินที่ยืนยัน')
assert.ok(!validateMoneyLineage(fundedPayroll, 1350).missing.includes('ผู้ถือเงิน'))
console.log('transfer slip money lineage contract: PASS')
