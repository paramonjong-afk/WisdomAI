import fs from 'node:fs'
import assert from 'node:assert/strict'
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
const migration=fs.readFileSync('supabase/migrations/202608150028_quotation_purchase_workflow.sql','utf8')
assert.match(page,/รายการราคาสินค้า/)
assert.match(page,/quotation_price_references/)
assert.match(page,/ราคาต่อหน่วย/)
assert.match(page,/บริษัทผู้ขาย/)
assert.match(migration,/insert into public\.quotation_price_references/)
assert.match(migration,/on conflict\(document_line_id\) do update/)
console.log('product price list checks passed')
