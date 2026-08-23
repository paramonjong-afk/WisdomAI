import assert from 'node:assert/strict'
import { emptyMoneyLineage, moneyPurposeRoute, validateMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'

const draft = emptyMoneyLineage('บริษัท', 'นาย ก', 10000, '2026-08-23T10:00')
draft.fundingSourceType = 'reserve_fund'
draft.fundHolderName = 'นาย ก'
draft.purposeType = 'materials'
draft.projectId = 'project-1'
draft.startingAmount = '50000'
draft.returnedAmount = '0'
draft.remainingAmount = '40000'
assert.deepEqual(validateMoneyLineage(draft, 10000), { missing: [], errors: [] })
assert.deepEqual(moneyPurposeRoute('materials').departments, ['inventory', 'project'])
assert.equal(moneyPurposeRoute('payroll').route, 'บัญชี → HR/ค่าแรง')
draft.paidAmount = '9000'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดจ่ายไม่ตรง/)
draft.paidAmount = '10000'; draft.remainingAmount = '41000'
assert.match(validateMoneyLineage(draft, 10000).errors.join(' '), /ยอดตั้งต้น/)
console.log('transfer slip money lineage contract: PASS')
