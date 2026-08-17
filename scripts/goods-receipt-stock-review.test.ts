import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150030_goods_receipt_stock_review.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /goods_receipt_reviews/)
assert.match(migration, /goods_receipt_line_reviews/)
assert.match(migration, /supplier_name_required/)
assert.match(migration, /confirm_goods_receipt_stock/)
assert.match(migration, /movement_type,quantity/)
assert.match(migration, /posting_status='not_posted'/)
assert.match(migration, /condition_value='rejected'/)
assert.match(page, /ชื่อบริษัท\/ผู้ส่งสินค้า/)
assert.match(page, /รับสินค้าเข้า Stock/)
assert.match(page, /ยืนยันรับเข้า Stock/)
assert.match(page, /documentType !== 'goods_receipt'/)
assert.match(page, /รับเข้า Stock แล้ว/)
assert.match(page, /goods_receipt_allocations/)
assert.match(page, /savedStockAllocations/)
assert.match(page, /stockAllocationResult/)
assert.match(page, /\['pending', 'needs_correction'\]\.includes\(document\.status\)/)

console.log('goods receipt stock review tests passed')
