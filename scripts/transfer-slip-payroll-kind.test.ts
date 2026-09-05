import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { emptyMoneyLineage, moneyPurposeRoute, validateMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'

const salary = emptyMoneyLineage('ผู้จ่าย', 'ผู้รับเงินเดือน', 30000)
salary.fundingSourceType = 'personal_reimbursement'
salary.allocations[0].purposeType = 'payroll'
salary.allocations[0].payrollKind = 'salary'
salary.allocations[0].employeeProfileId = '11111111-1111-4111-8111-111111111111'
salary.allocations[0].receivedByProfileId = salary.allocations[0].employeeProfileId
salary.allocations[0].payPeriodId = '22222222-2222-4222-8222-222222222222'
salary.allocations[0].costCategoryId = '33333333-3333-4333-8333-333333333333'
salary.allocations[0].accountCode = '5201'
salary.allocations[0].accountName = 'ค่าแรงและเงินเดือนโครงการ'
assert.equal(moneyPurposeRoute('payroll', 'salary').label, 'เงินเดือน')
assert.equal(moneyPurposeRoute('payroll', 'salary').route, 'บัญชี → HR/เงินเดือน')
assert.deepEqual(validateMoneyLineage(salary, 30000), { missing: [], errors: [] })

const unknownPayroll = emptyMoneyLineage('ผู้จ่าย', 'ผู้รับ', 500)
unknownPayroll.fundingSourceType = 'company_account'
unknownPayroll.allocations[0].purposeType = 'payroll'
assert.match(validateMoneyLineage(unknownPayroll, 500).missing.join(' '), /ชนิดเงินเดือน\/ค่าแรง/)
assert.match(validateMoneyLineage(unknownPayroll, 500).missing.join(' '), /เจ้าของเงินเดือน\/ค่าแรง/)
assert.match(validateMoneyLineage(unknownPayroll, 500).missing.join(' '), /งวดค่าแรง/)

const migration = readFileSync('supabase/migrations/20260905110100_confirm_salary_payroll_evidence.sql', 'utf8')
assert.match(migration, /transfer_slip_payroll_kind_confirmed/)
assert.match(migration, /'payroll_kind', 'salary'/)
assert.match(migration, /source_preserved', true/)
console.log('transfer slip payroll kind: PASS')
