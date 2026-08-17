import fs from 'node:fs'
import assert from 'node:assert/strict'
const sql=fs.readFileSync('supabase/migrations/202608150033_split_document_product_lines.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/split_accounting_document_line/,/split_original_description/,/split_original_quantity/,/split_quantity_mismatch/,/manual_product_variant_split/,/at_least_two_split_items_required/])assert.match(sql,pattern)
assert.match(sql,/delete from public\.accounting_line_allocations/)
assert.match(page,/แยกรายการสินค้า/)
assert.match(page,/ยืนยันแยกรายการ/)
assert.match(page,/split_accounting_document_line/)
console.log('product line split checks passed')
