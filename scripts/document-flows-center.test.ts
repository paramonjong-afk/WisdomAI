import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const route = readFileSync('src/router/index.tsx', 'utf8')
const navigation = readFileSync('src/utils/navigation.ts', 'utf8')
const posting = readFileSync('supabase/migrations/202608160026_posting_flow_work_backlog.sql', 'utf8')

for (const term of ['Intake Room', 'Filter', 'คิวงานปลายทาง', 'IntakeRoomPanel', 'ตัวกรองข้อมูลกลาง']) {
  assert.ok(page.includes(term), `missing: ${term}`)
}
for (const term of ['ทุกแผนก', 'บัญชี', 'จัดซื้อ', 'สต็อก/รับสินค้า', 'departmentsFor']) {
  assert.ok(page.includes(term), `missing department queue: ${term}`)
}
assert.ok(!page.includes('PageHeader title="ศูนย์เส้นทางเอกสาร"'), 'Document Flow Center must not render the redundant page header')
assert.ok(route.includes("path: 'document-flows'"))
assert.match(route, /document-flows\/intake-room'.*Navigate to="\/document-flows"/)
assert.ok(navigation.includes("path:'/document-flows'"))
assert.ok(!navigation.includes("path:'/document-flows/intake-room'"))
for (let index = 1; index <= 10; index += 1) assert.ok(posting.includes(`POSTING-${String(index).padStart(3, '0')}`))
for (const field of ['confidence', 'current_flow', 'current_room', 'version']) assert.ok(page.includes(field))
assert.ok(page.includes('loadQueuePage'), 'Document Flow Center must use the cursor gateway')
assert.ok(page.includes('nextCursor'), 'Document Flow Center must retain the server cursor')
assert.ok(!gateway.includes('async loadCenter'), 'legacy 2,000-row Document Flow Center query must be removed')
assert.ok(!page.includes('limit(2000)'), 'Document Flow Center must not fetch an unbounded queue')
console.log('Document Flow Center contracts: ok')
