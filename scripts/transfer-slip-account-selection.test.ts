import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AccountingDocuments/index.tsx', import.meta.url), 'utf8')
const model = readFileSync(new URL('../src/services/transferSlipMoneyLineage.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../supabase/migrations/20260829002558_transfer_slip_allocation_account_selection.sql', import.meta.url), 'utf8')

assert.match(page, /รายการบัญชีค่าใช้จ่าย \(จำเป็น\)/)
assert.match(page, /accounting_cost_categories/)
assert.match(page, /cost_category_id/)
assert.match(page, /canonical_accounting_cost_category/)
assert.match(model, /moneyPurposeNeedsExpenseAccount/)
assert.match(model, /บัญชีค่าใช้จ่ายรายการที่/)
assert.match(migration, /add column if not exists cost_category_id/)
assert.match(migration, /money_allocation_account_required/)
assert.match(migration, /category\.company_id is null or category\.company_id = new\.company_id/)
assert.doesNotMatch(migration, /create table .*account/i)

console.log('transfer slip account selection contract: PASS')
