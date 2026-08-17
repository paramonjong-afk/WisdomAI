import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/AccountingDocuments/index.tsx', import.meta.url), 'utf8')

assert.match(source, /source_message_id,document_type,document_number/)
assert.match(source, /accounting_document_lines.*document_id,description,quantity,unit,line_amount/)
assert.match(source, /viewDocumentAttachment\(item\.sourceMessageId\)/)
assert.match(source, /ดูภาพเอกสาร/)
assert.match(source, /เปรียบเทียบรายการใบวางบิลกับเอกสารรับ/)
assert.match(source, /ไม่พบรายการ/)
assert.match(source, /จำนวนต่าง/)
assert.match(source, /ยอดเอกสารรับ/)

console.log('billing receipt comparison and preview checks passed')
