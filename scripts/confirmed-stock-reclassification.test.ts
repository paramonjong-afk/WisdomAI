import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync('supabase/migrations/202608160002_confirmed_receipt_stock_reclassification.sql','utf8')
const revisionSql=fs.readFileSync('supabase/migrations/202608160004_revise_confirmed_stock_reclassification.sql','utf8')
const standardSql=fs.readFileSync('supabase/migrations/202608160005_standard_split_project_destination.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
for(const pattern of [/reclassify_confirmed_receipt_stock_line/,/confirmed_goods_receipt_required/,/single_stock_allocation_required_for_correction/,/insufficient_source_stock/,/'adjustment',-expected/,/'adjustment',qty/,/stock_line_already_reclassified/,/quantity_before/,/quantity_after/])assert.match(sql,pattern)
for(const pattern of [/selected\?\.status==='confirmed'/,/reclassify_confirmed_receipt_stock_line/,/ยอดรวมไม่เปลี่ยน/,/suggestedProductSplit/,/quantity:6/,/quantity:2/,/ดึงค่าที่แนะนำ/])assert.match(page,pattern)
for(const pattern of [/previous_split_stock_already_used/,/ย้อนรายการแยกเดิม/,/คืนยอดเพื่อแก้รายการแยก/,/'revised'/,/having abs\(coalesce\(sum\(m\.quantity\),0\)\)>\.001/])assert.match(revisionSql,pattern)
for(const pattern of [/reclassify_confirmed_receipt_stock_line_standard/,/standard_destinations_saved/,/project_required_for_split_item/,/site_not_in_project/,/รับและใช้ทันทีจากรายการแยก/])assert.match(standardSql,pattern)
console.log('confirmed stock reclassification checks passed')
