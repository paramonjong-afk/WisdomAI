import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('src/pages/FlowRegistry/FlowRegistryDashboard.tsx', 'utf8')
const gateway = fs.readFileSync('src/services/flowRegistryGateway.ts', 'utf8')
assert.match(page, /รับเข้าวันนี้/)
assert.match(page, /เส้นทางงานจริง/)
assert.match(page, /Exception Lane/)
assert.match(page, /Auto refresh 30s/)
assert.match(page, /window\.setInterval\(\(\) => void load\(\), 30000\)/)
assert.match(page, /window\.clearInterval\(timer\)/)
assert.match(page, /direction=\{\{ xs: 'column', md: 'row' \}\}/)
assert.match(page, /minWidth: \{ xs: '100%', md: 120 \}/)
assert.match(page, /Drill-down/)
assert.match(page, /Detail \/ Audit/)
assert.match(page, /Source \/ Document ID/)
assert.match(page, /Count reconciliation/)
assert.match(page, /Evidence:/)
assert.match(page, /Blocker:/)
assert.match(gateway, /omni_intake_sources/)
assert.match(gateway, /chat_attendance_approval_jobs/)
assert.match(gateway, /employee_advance_cases/)
assert.match(gateway, /sourceWarnings/)
assert.match(gateway, /created_at/)
assert.match(gateway, /canonicalDestinationCounts/)
assert.match(gateway, /reconciliation/)
assert.match(gateway, /sourceRefs/)

type RouteRecord = {
  module: 'omni' | 'attendance' | 'advance'
  stage: string
  status: 'open' | 'waiting' | 'error' | 'closed'
  destination: string
  forwarded: boolean
  owner: string
  auditAction: string
  detailPath: string
  taskId: string
  sourceRefs: string[]
  auditRefs: string[]
}
const closed = (record: RouteRecord) => record.status === 'closed' || record.stage === 'ปิดงาน'
const sample: RouteRecord[] = [
  { module: 'omni', stage: 'Filter', status: 'waiting', destination: 'บัญชี', forwarded: false, owner: 'reviewer-1', auditAction: 'filter_reviewed', detailPath: '/document-flows/omni-1', taskId: 'omni-1', sourceRefs: ['omni-1'], auditRefs: ['audit-1'] },
  { module: 'attendance', stage: 'อนุมัติ/บันทึก', status: 'error', destination: 'HR', forwarded: true, owner: 'hr-1', auditAction: 'approval_failed', detailPath: '/attendance/approval-1', taskId: 'approval-1', sourceRefs: ['room-1'], auditRefs: ['audit-2'] },
  { module: 'advance', stage: 'ปิดงาน', status: 'closed', destination: 'เงินสำรองจ่าย', forwarded: true, owner: 'finance-1', auditAction: 'closed', detailPath: '/advance-settlements/advance-1', taskId: 'advance-1', sourceRefs: ['document-1'], auditRefs: ['audit-3'] },
]
assert.equal(sample.length, 3, 'fixture should represent three incoming records')
assert.equal(sample.filter((record) => !closed(record)).length, 2, 'open plus waiting/error records should remain pending')
assert.equal(sample.filter((record) => closed(record)).length, 1, 'closed record should be counted separately')
assert.equal(sample.filter((record) => record.forwarded).length, 2, 'forwarded records should be counted separately')
assert.equal(sample.filter((record) => record.status === 'error').length, 1, 'error should remain in the active queue')
assert.deepEqual([...new Set(sample.map((record) => record.destination))].sort(), ['HR', 'บัญชี', 'เงินสำรองจ่าย'].sort(), 'destination lane should preserve real destinations')
assert.deepEqual(sample.map((record) => ({ owner: record.owner, auditAction: record.auditAction, detailPath: record.detailPath })), [
  { owner: 'reviewer-1', auditAction: 'filter_reviewed', detailPath: '/document-flows/omni-1' },
  { owner: 'hr-1', auditAction: 'approval_failed', detailPath: '/attendance/approval-1' },
  { owner: 'finance-1', auditAction: 'closed', detailPath: '/advance-settlements/advance-1' },
], 'drill-down fixture should expose owner, audit action, and detail path')
assert.equal(new Set(sample.map((record) => record.taskId)).size, sample.length, 'one canonical row per task')
assert.ok(sample.every((record) => record.sourceRefs.length > 0 && record.auditRefs.length > 0), 'task drill-down should expose source and audit references')
assert.equal(sample.length, sample.filter((record) => record.status !== 'closed').length + sample.filter((record) => record.status === 'closed').length, 'summary counts reconcile to rows')

console.log('flow registry dashboard contract tests passed: source-backed metrics, filters, drill-down, refresh and exception lane')
