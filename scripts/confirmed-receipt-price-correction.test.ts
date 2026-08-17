import fs from 'node:fs'
import assert from 'node:assert/strict'
const sql=fs.readFileSync('supabase/migrations/202608160001_confirmed_receipt_price_correction.sql','utf8')
const page=fs.readFileSync('src/pages/AccountingDocuments/index.tsx','utf8')
const aliasFix=fs.readFileSync('supabase/migrations/202608160003_fix_confirmed_receipt_price_alias.sql','utf8')
for(const pattern of [/save_confirmed_goods_receipt_prices/,/confirmed_goods_receipt_required/,/received_quantity\*price_value/,/capture_confirmed_document_prices/,/price_basis='actual'/,/confirmed_goods_receipt_actual_price_correction/])assert.match(sql,pattern)
for(const pattern of [/saveConfirmedReceiptPrices/,/ราคาซื้อจริง\/หน่วย/,/บันทึกราคาซื้อจริง/,/updated_count/])assert.match(page,pattern)
assert.match(aliasFix,/gr_line\.document_line_id=price_line\.id/)
assert.doesNotMatch(aliasFix,/join public\.goods_receipt_line_reviews review/)
console.log('confirmed receipt price correction checks passed')
