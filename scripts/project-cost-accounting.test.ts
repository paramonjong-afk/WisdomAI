import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150023_project_cost_accounting_allocation.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

for (const code of ['01','02','03','04','05','06','07','08','09','10']) {
  assert.match(migration, new RegExp(`'${code}'`))
}
for (const welfareCode of ['02.01','02.02','02.03','02.04','02.05','02.06','02.07','02.08']) {
  assert.match(migration, new RegExp(welfareCode.replace('.', '\\.')))
}
assert.match(migration, /create table if not exists public\.accounting_line_allocations/)
assert.match(migration, /allocation_amount_mismatch_line_/)
assert.match(migration, /allocation_percent_mismatch_line_/)
assert.match(migration, /save_accounting_document_classification/)
assert.match(migration, /project_not_in_company/)
assert.match(migration, /site_not_in_project/)
assert.match(page, /แบ่งเพิ่มอีกโครงการ/)
assert.match(page, /Cost Center/)
assert.match(page, /WBS\/งวดงาน/)
assert.match(page, /validationErrors/)
assert.match(page, /save_accounting_document_classification/)

console.log('project cost accounting allocation tests passed')
