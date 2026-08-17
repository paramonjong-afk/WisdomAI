import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const workflow = readFileSync('supabase/migrations/202608150028_quotation_purchase_workflow.sql', 'utf8')
const nonPosting = readFileSync('supabase/migrations/202608160007_quotation_project_reference_only.sql', 'utf8')

assert.match(page, /รายการและราคาอ้างอิง/)
assert.match(page, /บันทึกราคาอ้างอิง/)
assert.match(page, /อนุมัติและสร้าง PO/)
assert.match(page, /ไม่เข้า Stock ไม่ลงต้นทุน และไม่สร้างเจ้าหนี้/)
assert.match(page, /documentType !== 'quotation' && <>/)
assert.match(page, /selectedStockLineIds\.includes\(line\.line_id\)/)
assert.doesNotMatch(page, /selected\.status === 'confirmed' \? 'บันทึกการตัดสินใจแล้ว'/)
assert.match(workflow, /public\.quotation_price_references/)
assert.match(workflow, /public\.purchase_orders/)
assert.match(workflow, /source_quotation_document_id/)
assert.match(nonPosting, /posting_status='not_posted'/)
assert.match(nonPosting, /cost_recognized',false/)

console.log('quotation reference to PO workflow checks passed')
