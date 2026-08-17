import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/202608160009_utility_invoice_direct_ap.sql', 'utf8')
const ui = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(sql, /create_utility_invoice_ap/)
assert.match(sql, /utility_expense_required/)
assert.match(sql, /confirm_accounting_document_pre_match/)
assert.match(sql, /goods_or_asset_line_requires_receipt/)
assert.match(ui, /isUtilityInvoice/)
assert.match(ui, /สร้างเจ้าหนี้ค่าสาธารณูปโภค/)
assert.match(ui, /create_utility_invoice_ap/)
console.log('utility direct AP checks passed')
