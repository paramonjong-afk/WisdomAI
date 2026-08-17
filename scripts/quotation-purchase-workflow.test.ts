import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150028_quotation_purchase_workflow.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

for (const table of ['quotation_decisions','quotation_line_decisions','quotation_price_references','purchase_orders','purchase_order_lines']) {
  assert.match(migration, new RegExp(`public\\.${table}`))
}
for (const action of ['order_full','order_partial','not_ordered','reference_only','expired','cancelled']) {
  assert.match(migration, new RegExp(`'${action}'`))
  assert.match(page, new RegExp(`${action}:`))
}
assert.match(migration, /ordered_quantity<=offered_quantity/)
assert.match(migration, /ordered_quantity_exceeds_remaining_line_/)
assert.match(migration, /project_required_before_order/)
assert.match(migration, /quotation_decision/)
assert.match(page, /อนุมัติและสร้าง PO/)
assert.match(page, /documentType === 'quotation' \? <Button/)
assert.match(page, /'ยืนยันใบเสนอราคา'/)
assert.match(page, /ใบเสนอราคาไม่ลงบัญชีจนกว่าจะมีใบรับของหรือใบแจ้งหนี้/)

console.log('quotation purchase workflow tests passed')
