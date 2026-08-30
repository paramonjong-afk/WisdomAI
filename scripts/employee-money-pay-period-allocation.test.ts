import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260830024834_employee_money_pay_period_allocations.sql', 'utf8')
const allocationService = readFileSync('src/services/transferSlipMoneyLineage.ts', 'utf8')
const accountingUi = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const holdingUi = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const timeUi = readFileSync('src/pages/TimeTracking/index.tsx', 'utf8')

assert.match(migration, /employee_profile_id uuid references public\.profiles/)
assert.match(migration, /received_by_profile_id uuid references public\.profiles/)
assert.match(migration, /pay_period_id uuid references public\.pay_periods/)
assert.match(migration, /payroll_period_locked_use_adjustment/)
assert.match(migration, /with \(security_invoker = true\)/)
assert.match(migration, /revoke all on public\.employee_money_ledger_detail_v1 from public, anon/)
assert.match(migration, /revoke all on function public\.hydrate_transfer_slip_employee_allocation\(\) from public, anon, authenticated/)

assert.match(allocationService, /เจ้าของเงินเดือน\/ค่าแรงรายการที่/)
assert.match(allocationService, /งวดค่าแรงรายการที่/)
assert.match(accountingUi, /เจ้าของเงินเดือน\/ค่าแรง/)
assert.match(accountingUi, /ผู้รับเงินจริง/)
assert.match(accountingUi, /รอบปิดงวดค่าแรง/)
assert.match(accountingUi, /field: 'employee_profile_id'/)
assert.match(accountingUi, /field: 'received_by_profile_id'/)
assert.match(accountingUi, /field: 'pay_period_id'/)

assert.match(holdingUi, /employee_money_ledger_detail_v1/)
assert.match(holdingUi, /วันเวลาโอน:/)
assert.match(holdingUi, /เลขอ้างอิง:/)
assert.match(holdingUi, /ผู้รับเงินจริง:/)
assert.match(timeUi, /employee_time_payroll_financial_summary_v1/)
assert.match(timeUi, /สรุปเวลาและการเงินตามงวด/)
assert.match(timeUi, /คาดว่าคงจ่าย/)

console.log('employee money pay-period allocation contract: PASS')
