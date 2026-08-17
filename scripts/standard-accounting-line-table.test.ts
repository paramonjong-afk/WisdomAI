import assert from 'node:assert/strict'
import fs from 'node:fs'
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/accounting-document-standard-lines/,/ค้นหารายการเอกสาร/,/หมวดต้นทุนหลัก/,/โครงการ \/ ไซต์ \/ หมวด \/ สัดส่วน \/ จำนวนเงิน/,/แบ่งเพิ่มอีกโครงการ/,/applyAccountingDefaults/,/ใช้กับรายการที่เลือก/,/เลือกทั้งหมด/])assert.match(page,pattern)
console.log('standard accounting line table checks passed')
