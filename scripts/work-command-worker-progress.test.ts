import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/pages/WorkCommandCenter/index.tsx', 'utf8')
const flow = readFileSync('docs/WORK_COMMAND_CENTER_FLOW.md', 'utf8')
assert.match(source, /current_step,worker_id,heartbeat_at,lease_expires_at/)
assert.match(source, /type WorkerOutcome = "acknowledged" \| "claimed" \| "blocked" \| "completed" \| "no_output"/)
assert.match(source, /hasStaleHeartbeat/)
assert.match(source, /document\.getSelection\(\)\?\.toString\(\)/)
assert.match(source, /Worker ยังไม่ยืนยันความคืบหน้าเกิน 10 นาที/)
assert.match(source, /\.from\("system_worker_runs"\)/)
assert.match(source, /Worker runs ล่าสุด/)
assert.match(flow, /```mermaid/)
assert.match(flow, /system_work_items/)
assert.match(flow, /system_worker_runs/)
console.log('work command worker progress contract passed')
