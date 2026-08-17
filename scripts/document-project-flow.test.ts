import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/202608160006_document_project_flow.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/save_accounting_document_project/,/quotation_price_references add column if not exists project_id/,/source_quotation_document_id/,/goods_receipt_allocations/,/document_project_assignment/])assert.match(sql,pattern)
for(const pattern of [/persistDocumentProject/,/ค้นหาสินค้า รหัส ผู้ขาย หรือโครงการ/,/ราคากลางบริษัท/])assert.match(page,pattern)
console.log('document project flow checks passed')
