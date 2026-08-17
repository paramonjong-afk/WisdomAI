import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/202608160008_supplier_invoice_creditor.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/save_supplier_invoice_creditor/,/creditor_name_required/,/supplier_invoice_creditor_confirmation/])assert.match(sql,pattern)
for(const pattern of [/เจ้าหนี้\/ผู้ขายที่จะสร้าง/,/ข้อมูลที่ยังขาด/,/matchingReceipts/,/บันทึกเจ้าหนี้ไม่สำเร็จ/])assert.match(page,pattern)
console.log('supplier invoice creditor checks passed')
