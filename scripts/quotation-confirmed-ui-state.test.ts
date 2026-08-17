import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
assert.match(ui, /confirmedQuotation = \{ \.\.\.selected, status: 'confirmed'/)
assert.match(ui, /selected\.status === 'confirmed' \? \('/)
assert.match(ui, /บันทึก' \+ 'การตัดสินใจแล้ว'/)
assert.match(ui, /เอกสารนี้ยืนยันเรียบร้อยแล้ว ไม่ต้องบันทึกประเภทซ้ำ/)
assert.match(ui, /documentType === selected\.document_type && documentPurpose === selected\.document_purpose/)
console.log('quotation confirmed UI state checks passed')
