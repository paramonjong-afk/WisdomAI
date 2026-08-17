import fs from 'node:fs'
import assert from 'node:assert/strict'
const sql=fs.readFileSync('supabase/migrations/202608150034_actual_received_product_prices.sql','utf8')
for(const pattern of [/capture_actual_received_product_prices/,/received_quantity/,/price_basis/,/'actual'/,/zz_capture_actual_received_product_prices/,/on conflict\(document_line_id\) do update/])assert.match(sql,pattern)
console.log('actual received product price checks passed')
