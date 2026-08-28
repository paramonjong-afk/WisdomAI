import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { emptyMoneyLineage, moneyPurposeRoute, validateMoneyLineage } from '../src/services/transferSlipMoneyLineage.ts'

const salary = emptyMoneyLineage('ผู้จ่าย', 'ผู้รับเงินเดือน', 30000)
salary.fundingSourceType = 'personal_reimbursement'
salary.allocations[0].purposeType = 'payroll'
salary.allocations[0].payrollKind = 'salary'
assert.equal(moneyPurposeRoute('payroll', 'salary').label, 'เงินเดือน')
assert.equal(moneyPurposeRoute('payroll', 'salary').route, 'บัญชี → HR/เงินเดือน')
assert.deepEqual(validateMoneyLineage(salary, 30000), { missing: [], errors: [] })

const unknownPayroll = emptyMoneyLineage('ผู้จ่าย', 'ผู้รับ', 500)
unknownPayroll.fundingSourceType = 'company_account'
unknownPayroll.allocations[0].purposeType = 'payroll'
assert.match(validateMoneyLineage(unknownPayroll, 500).missing.join(' '), /ชนิดเงินเดือน\/ค่าแรง/)

const migration = readFileSync('supabase/migrations/20260829103500_classify_salary_payroll_evidence.sql', 'utf8')
assert.match(migration, /transfer_slip_payroll_kind_confirmed/)
assert.match(migration, /'payroll_kind', 'salary'/)
assert.match(migration, /source_preserved', true/)
console.log('transfer slip payroll kind: PASS')
