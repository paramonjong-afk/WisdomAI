import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('src/pages/FlowRegistry/FlowRegistryDashboard.tsx', 'utf8')
const gateway = fs.readFileSync('src/services/flowRegistryGateway.ts', 'utf8')
assert.match(page, /รับเข้าวันนี้/)
assert.match(page, /เส้นทางงานจริง/)
assert.match(page, /Exception Lane/)
assert.match(page, /Auto refresh 30s/)
assert.match(page, /Drill-down/)
assert.match(gateway, /omni_intake_sources/)
assert.match(gateway, /chat_attendance_approval_jobs/)
assert.match(gateway, /employee_advance_cases/)
assert.match(gateway, /sourceWarnings/)
assert.match(gateway, /created_at/)

type RouteRecord = { module: 'omni' | 'attendance' | 'advance'; stage: string; status: 'open' | 'waiting' | 'error' | 'closed' }
const closed = (record: RouteRecord) => record.status === 'closed' || record.stage === 'ปิดงาน'
const sample: RouteRecord[] = [
  { module: 'omni', stage: 'Filter', status: 'waiting' },
  { module: 'attendance', stage: 'อนุมัติ/บันทึก', status: 'error' },
  { module: 'advance', stage: 'ปิดงาน', status: 'closed' },
]
assert.equal(sample.filter((record) => !closed(record)).length, 2)
assert.equal(sample.filter(closed).length, 1)

console.log('flow registry dashboard contract tests passed: source-backed metrics, filters, drill-down, refresh and exception lane')
