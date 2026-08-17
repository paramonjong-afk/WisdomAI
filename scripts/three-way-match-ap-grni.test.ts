import fs from 'node:fs'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('supabase/migrations/202608150031_three_way_match_ap_grni.sql', 'utf8')
assert.match(sql, /create_goods_receipt_grni/)
assert.match(sql, /match_invoice_and_create_ap/)
assert.match(sql, /three_way_match_required_before_ap/)
assert.match(sql, /confirm_accounting_document_pre_match/)
assert.match(sql, /'2110','รับสินค้าแล้วรอใบแจ้งหนี้ \(GRNI\)'/)
assert.match(sql, /'2100','เจ้าหนี้การค้า'/)
assert.match(sql, /status='needs_correction'/)
console.log('three-way match AP/GRNI migration checks passed')
