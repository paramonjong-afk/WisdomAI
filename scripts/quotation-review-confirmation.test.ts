import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150029_quotation_review_confirmation.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /confirm_quotation_review_after_decision/)
assert.match(migration, /status='confirmed',posting_status='not_posted'/)
assert.match(migration, /document_type='quotation'/)
assert.match(migration, /decision\.status<>'pending'/)
assert.match(page, /ยืนยันใบเสนอราคา/)
assert.match(page, /ยืนยันและสร้าง PO/)
assert.match(page, /ตรวจใบเสนอราคาแล้ว/)
assert.match(page, /รอตัดสินใจ/)

console.log('quotation review confirmation tests passed')
