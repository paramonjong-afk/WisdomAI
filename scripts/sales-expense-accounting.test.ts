import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateSalesExpenseAmounts, canApproveSalesExpense, canEditSalesExpense } from '../src/services/salesExpenseAccounting.ts'

const migration = readFileSync('supabase/migrations/20260831023857_sales_expense_accounting_workflow.sql', 'utf8')
const panel = readFileSync('src/pages/ProjectControls/SalesExpensePanel.tsx', 'utf8')
const projectControls = readFileSync('src/pages/ProjectControls/index.tsx', 'utf8')
const registry = readFileSync('src/pages/FlowRegistry/index.tsx', 'utf8')
const flow = readFileSync('docs/SALES_EXPENSE_ACCOUNTING_FLOW.md', 'utf8')

assert.deepEqual(calculateSalesExpenseAmounts(10_000, 7, 2), {
  base: 10_000,
  vat: 700,
  withholding: 200,
  gross: 10_700,
  netPayable: 10_500,
})
assert.equal(canEditSalesExpense('draft'), true)
assert.equal(canEditSalesExpense('rejected'), true)
assert.equal(canEditSalesExpense('approved'), false)
assert.equal(canApproveSalesExpense('pending', 'maker-id', 'maker-id'), false)
assert.equal(canApproveSalesExpense('pending', 'maker-id', 'checker-id'), true)
assert.equal(canApproveSalesExpense('approved', 'maker-id', 'checker-id'), false)

for (const code of ['11.01', '11.02', '11.03', '11.04', '11.05', '11.06', '11.07', '11.08', '11.09']) {
  assert.match(migration, new RegExp(code.replace('.', '\\.')))
}
for (const account of ['6210', '6220', '6230', '6240', '6250', '6260', '6270', '6280', '6290']) {
  assert.match(migration, new RegExp(`'${account}'`))
}
assert.match(migration, /create table if not exists public\.sales_expense_audit/)
assert.match(migration, /create or replace function public\.save_sales_expense_draft/)
assert.match(migration, /create or replace function public\.transition_sales_expense/)
assert.match(migration, /sales_expense_maker_checker_required/)
assert.match(migration, /sales_expense_document_total_mismatch/)
assert.match(migration, /sales_expense_document_project_mismatch/)
assert.match(migration, /sales_expense_document_vendor_mismatch/)
assert.match(migration, /source_sales_expense_id is not null/)
assert.match(migration, /delete from public\.accounting_draft_entries entry\s+where entry\.document_id = document_row\.id/)
assert.match(migration, /revoke all on public\.sales_expenses from anon, authenticated/)
assert.match(migration, /unique\(company_id, event_key\)/)
assert.match(migration, /legacy_unverified/)
assert.doesNotMatch(migration, /delete from public\.sales_expenses/i)
assert.doesNotMatch(migration, /delete from public\.sales_expense_audit/i)

assert.match(panel, /rpc\('save_sales_expense_draft'/)
assert.match(panel, /rpc\('transition_sales_expense'/)
assert.match(panel, /rpc\('classify_sales_expense_outcome'/)
assert.match(panel, /salesExpenseStatusLabels/)
assert.match(panel, /Maker-Checker/)
assert.match(panel, /onRowClick=\{openRow\}/)
assert.doesNotMatch(panel, /from\('sales_expenses'\)\.insert/)
assert.doesNotMatch(panel, /from\('sales_expenses'\)\.update/)
assert.doesNotMatch(projectControls, /from\(["']sales_expenses["']\)/)
assert.match(projectControls, /<SalesExpensePanel/)

assert.match(registry, /Sales Expense Accounting v1\.0/)
assert.equal(flow.trimStart().startsWith('```mermaid'), true)
assert.match(flow, /ไม่ Posting หรือจ่ายเงินอัตโนมัติ/)

console.log('sales expense accounting workflow tests passed')
