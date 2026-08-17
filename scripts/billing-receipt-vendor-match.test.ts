import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page=readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
const sql=readFileSync('supabase/migrations/202608160014_billing_receipt_vendor_match.sql','utf8')

assert.match(page,/\.in\('document_type',\['delivery_note','goods_receipt'\]\)/)
assert.match(page,/จับคู่ใบส่งของ\/ใบรับสินค้ากับใบวางบิล/)
assert.match(page,/billingVariance/)
assert.match(page,/ยอดตรงกัน/)
assert.match(sql,/source_doc\.document_type not in \('delivery_note','goods_receipt'\)/)
assert.match(sql,/receiving_document_vendor_mismatch_/)
assert.match(sql,/matched_line_count/)
assert.match(sql,/unmatched_line_count/)
assert.match(sql,/abs\(coalesce\(received\.received_quantity,0\)-coalesce\(line\.quantity,0\)\)<=\.001/)

console.log('billing receipt vendor match checks passed')
