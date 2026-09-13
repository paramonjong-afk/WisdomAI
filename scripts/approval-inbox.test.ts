import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/pages/Approvals/index.tsx', 'utf8')
const flow = readFileSync('docs/APPROVAL_INBOX_FLOW.md', 'utf8')
assert.match(source, /system_work_items/)
assert.match(source, /decide_system_work_item_approval/)
assert.match(source, /work_key/)
assert.match(source, /approval_scope/)
assert.match(source, /evidence/)
assert.match(source, /host\/sandbox/)
assert.match(source, /ห้องต้นทาง/)
assert.match(flow, /```mermaid/)
assert.match(flow, /cross-thread Codex approval API/)
console.log('approval inbox capability boundary contract passed')
