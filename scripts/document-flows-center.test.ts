import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const route = readFileSync('src/router/index.tsx', 'utf8')
const navigation = readFileSync('src/utils/navigation.ts', 'utf8')
const posting = readFileSync('supabase/migrations/202608160026_posting_flow_work_backlog.sql', 'utf8')

for (const term of ['Intake Flow', 'Filter Flow', 'Posting Flow', 'Intake ID', 'AI ≥ 90%', 'ยังไม่ลงบัญชี/Stock/PO']) {
  assert.ok(page.includes(term), `missing: ${term}`)
}
assert.ok(route.includes("path: 'document-flows'"))
assert.ok(navigation.includes("path:'/document-flows'"))
for (let index = 1; index <= 10; index += 1) assert.ok(posting.includes(`POSTING-${String(index).padStart(3, '0')}`))
for (const field of ['confidence', 'current_flow', 'current_room', 'version']) assert.ok(page.includes(field))
console.log('Document Flow Center contracts: ok')
