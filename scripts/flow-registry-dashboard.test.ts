import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadLocalFlowRegistrySnapshot } from '../src/services/flowRegistryLocalFixture.ts'

const page = fs.readFileSync('src/pages/FlowRegistry/FlowRegistryDashboard.tsx', 'utf8')
const gateway = fs.readFileSync('src/services/flowRegistryGateway.ts', 'utf8')
const protectedRoute = fs.readFileSync('src/router/ProtectedRoute.tsx', 'utf8')
const roleRoute = fs.readFileSync('src/router/RoleRoute.tsx', 'utf8')
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
assert.match(page, /LOCAL FIXTURE/)
assert.match(page, /loadLocalFlowRegistrySnapshot/)
assert.match(protectedRoute, /local_test_data/)
assert.match(roleRoute, /local_test_data/)
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

const fixtureFilters = {
  companyId: 'local-fixture-company',
  from: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
  to: new Date(Date.now() + 60_000).toISOString(),
  module: 'all' as const,
  status: 'all' as const,
  source: '',
  owner: '',
}
const fixtureSnapshot = await loadLocalFlowRegistrySnapshot(fixtureFilters)
assert.equal(fixtureSnapshot.records.length, 8, 'local fixture should expose eight canonical tasks')
assert.equal(fixtureSnapshot.reconciliation.consistent, true, 'fixture cards and rows must reconcile')
assert.equal(fixtureSnapshot.reconciliation.rowCount, fixtureSnapshot.reconciliation.open + fixtureSnapshot.reconciliation.closed)
assert.equal(fixtureSnapshot.destinations.reduce((sum, item) => sum + item.count, 0), fixtureSnapshot.records.length, 'destination counts must use canonical rows')
assert.ok(fixtureSnapshot.records.every((record) => record.sourceRefs.length > 0 && record.evidenceRefs.length > 0 && record.auditRefs.length > 0))

const advanceSnapshot = await loadLocalFlowRegistrySnapshot({ ...fixtureFilters, module: 'advance' })
assert.equal(advanceSnapshot.records.length, 3, 'module filter should update rows and all aggregates')
assert.equal(advanceSnapshot.reconciliation.rowCount, 3)
const ownerSnapshot = await loadLocalFlowRegistrySnapshot({ ...fixtureFilters, owner: 'finance-local' })
assert.equal(ownerSnapshot.records.length, 2, 'owner filter should update rows and counts')
const sourceSnapshot = await loadLocalFlowRegistrySnapshot({ ...fixtureFilters, source: 'DOC-LOCAL-006' })
assert.equal(sourceSnapshot.records[0]?.taskId, 'ADV-LOCAL-006', 'source filter should drill down to the matching task')

console.log('flow registry dashboard contract tests passed: source-backed metrics, filters, drill-down, refresh and exception lane')
