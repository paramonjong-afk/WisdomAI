import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202609170003_posting_prerequisite_management.sql', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const page = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')

assert.match(migration, /add column if not exists purchase_order_line_id uuid/)
assert.match(migration, /foreign key\(purchase_order_line_id, company_id\)/)
assert.match(migration, /posting_prerequisite_events/)
assert.match(migration, /posting_prerequisite_already_reserved/)
assert.match(migration, /posting_purchase_order_line_not_compatible/)
assert.match(migration, /posting_accounting_period_closed_or_locked/)
assert.match(migration, /is_company_manager/)
assert.match(migration, /revoke insert,update,delete/)
assert.match(gateway, /get_posting_prerequisites/)
assert.match(gateway, /configure_posting_purchase_order_line/)
assert.match(gateway, /open_posting_accounting_period_for_document/)
assert.match(page, /ยืนยัน PO line/)
assert.match(page, /เปิดรอบเดือนนี้/)
assert.match(page, /accounting_period_open/)

console.log('posting prerequisite management contract passed')
