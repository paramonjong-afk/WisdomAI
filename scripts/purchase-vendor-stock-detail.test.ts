import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608160011_purchase_vendor_and_stock_detail_correction.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /save_purchase_document_vendor/)
assert.match(migration, /counterparty_type='vendor'/)
assert.match(migration, /save_accounting_product_details/)
assert.match(migration, /update public\.accounting_document_lines set description=trim\(p_description\),quantity=p_quantity/)
assert.match(migration, /update public\.inventory_movements set quantity=p_quantity,unit_cost=p_unit_price/)
assert.match(migration, /will_enter_stock_on_confirmation/)
assert.match(page, /label="ชื่อผู้ขายจริง"/)
assert.match(page, /บันทึกผู้ขาย/)
assert.match(page, /บันทึกสินค้า\/Stock/)
assert.match(page, /line\.item_type==='stock'\?'รับเข้า Stock':'ต้นทุนตรง ไม่เข้า Stock'/)
assert.match(page, /p_quantity:Number\(line\.quantity\?\?0\)/)

console.log('purchase vendor and stock detail correction tests passed')
