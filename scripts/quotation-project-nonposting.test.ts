import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/202608160007_quotation_project_reference_only.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/quotation_project_required/,/posting_status='not_posted'/,/accounting_posted',false/,/cost_recognized',false/,/quotation_price_references set project_id/])assert.match(sql,pattern)
for(const pattern of [/process_quotation_decision_with_project/,/ยอดนี้เป็นราคาอ้างอิงและยังไม่ลงต้นทุน/,/ไม่เป็นต้นทุนจริง/])assert.match(page,pattern)
console.log('quotation project non-posting checks passed')
