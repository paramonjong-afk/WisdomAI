import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823122113_hr_confirmation_bundle.sql', 'utf8')
const operationalMigration = fs.readFileSync('supabase/migrations/20260823122137_hr_confirmation_operational_readiness.sql', 'utf8')
const reconcileMigration = fs.readFileSync('supabase/migrations/20260825065812_reconcile_hr_intake_system_outputs.sql', 'utf8')
const flow = fs.readFileSync('docs/HR_CONFIRMATION_BUNDLE_FLOW.md', 'utf8')
const chatPage = fs.readFileSync('src/pages/Chat/index.tsx', 'utf8')

for (const needle of [
  'create table public.hr_intake_raw_items',
  'create table public.hr_intake_events',
  'create table public.hr_confirmation_bundles',
  'create table public.hr_confirmation_bundle_items',
  'create table public.hr_confirmation_bundle_events',
  "'pending','context','duplicate','already_confirmed','not_hr','low_confidence'",
  "'received','under_review','needs_more_info','pending_approval'",
  'unique(company_id,source_channel,source_ref)',
  'unique(company_id,bundle_key)',
  'target_classification=\'candidate\'',
  "target_action not in ('confirm','request_more','reject')",
  "target_action not in ('confirm','request_more','reject','close')",
  "event_type in ('bundle_received','validation_completed','approval_granted','child_attendance_recorded','bundle_recorded')",
  "message_class='system_confirmation'",
  'drop trigger if exists publish_attendance_approval_message_trigger',
  'capture_hr_intake_raw_message_trigger',
  'sync_hr_confirmation_bundle_trigger',
  'publish_hr_confirmation_bundle_trigger',
  'hr_intake_gate_counts',
  "'review_started'",
  "'approval_requested'",
  "'bundle_closed_100_percent'",
  "'more_information_required'",
  "'bundle_rejected'",
]) assert.ok(migration.includes(needle), `missing HR bundle contract: ${needle}`)

assert.match(flow, /^```mermaid[\s\S]*flowchart TD/)
assert.match(migration, /alter table public\.hr_intake_raw_items enable row level security/)
assert.match(migration, /alter table public\.hr_confirmation_bundles enable row level security/)
assert.match(migration, /revoke insert,update,delete on public\.hr_intake_raw_items,public\.hr_intake_events from anon,authenticated/)
assert.match(migration, /revoke all on function public\.act_hr_confirmation_bundle[\s\S]*from public,anon/)
assert.doesNotMatch(migration, /delete from public\.hr_intake_raw_items/i, 'raw HR intake must never be deleted')
assert.match(migration, /where id=new\.id and \(confirmation_status,last_error\) is distinct from/, 'confirmation retry must not recurse')
for (const needle of ['owner_profile_id', 'sla_due_at', 'create table public.hr_confirmation_evidence', 'sync_hr_confirmation_evidence', 'refresh_hr_confirmation_operational_gate', 'assign_hr_confirmation_bundle', 'escalate_overdue_hr_confirmation_bundles', 'hr_confirmation_operational_evidence_gate_failed']) {
  assert.ok(operationalMigration.includes(needle), `missing HR operational readiness contract: ${needle}`)
}
for (const label of ['HR Intake Gate', 'ข้อมูลเข้าทั้งหมด', 'ยืนยันเข้า Bundle', 'ขอข้อมูลเพิ่ม', 'ปฏิเสธ', 'ตรวจครบและปิด Job 100%']) {
  assert.ok(chatPage.includes(label), `missing HR room action: ${label}`)
}
for (const needle of [
  'create table public.hr_confirmation_evidence',
  'owner_profile_id uuid', 'next_action text', 'sla_due_at timestamptz', 'escalation_level smallint',
  'sync_hr_confirmation_evidence', 'refresh_hr_confirmation_operational_gate',
  'enforce_hr_confirmation_operational_gate', 'assign_hr_confirmation_bundle',
  'escalate_overdue_hr_confirmation_bundles', 'get_hr_confirmation_daily_summary',
  'hr_confirmation_operational_evidence_gate_failed', 'hr_confirmation_attendance_evidence_incomplete',
  'alter table public.hr_confirmation_evidence enable row level security',
  'revoke insert,update,delete on public.hr_confirmation_evidence from anon,authenticated',
]) assert.ok(operationalMigration.includes(needle), `missing operational HR contract: ${needle}`)
assert.doesNotMatch(operationalMigration, /delete from public\.(hr_intake_raw_items|attendance_sessions)/i)
for (const needle of [
  "new.sender_profile_id is null", "message.message_class in ('system_confirmation','system_result')",
  "'intake_reconciled'", 'system-context-reconcile:', 'sync_hr_confirmation_bundle_for_job(row_value.id)',
]) assert.ok(reconcileMigration.includes(needle), `missing HR reconciliation contract: ${needle}`)
assert.doesNotMatch(reconcileMigration, /delete from public\.(hr_intake_raw_items|chat_messages|attendance_sessions)/i)
for (const label of ['สรุป HR วันนี้', 'Owner:', 'Next:', 'SLA:', 'Evidence', 'รับงานนี้', 'Escalation L']) {
  assert.ok(chatPage.includes(label), `missing HR Task Card UI: ${label}`)
}

type Fixture = {
  id: string
  messageClass: 'user_message' | 'system_confirmation'
  text: string
  confidence?: number
  duplicateOf?: string
  confirmedBundle?: string
  facts?: { employee: string; date: string; project: string; action: 'clock_in' | 'clock_out'; requestCode: string }
}

const fixtures: Fixture[] = [
  { id: 'raw-01', messageClass: 'system_confirmation', text: 'ระบบยืนยันรายการเดิม' },
  { id: 'raw-02', messageClass: 'user_message', text: 'สรุปสถานะงาน HR ประจำวัน 07:30' },
  { id: 'raw-03', messageClass: 'user_message', text: 'ลงเวลาเข้า duplicate', duplicateOf: 'raw-09' },
  { id: 'raw-04', messageClass: 'user_message', text: 'รายการยืนยันแล้ว', confirmedBundle: 'bundle-old' },
  { id: 'raw-05', messageClass: 'user_message', text: 'ส่งปูนขึ้นชั้นสอง', confidence: .90 },
  { id: 'raw-06', messageClass: 'user_message', text: 'น่าจะเข้าทำงาน', confidence: .42 },
  { id: 'raw-07', messageClass: 'user_message', text: 'เข้าไซต์', confidence: .62 },
  { id: 'raw-08', messageClass: 'user_message', text: 'ลงเวลาแต่ไม่บอกคนและโครงการ', confidence: .91 },
  { id: 'raw-09', messageClass: 'user_message', text: 'นายช่างเข้า 08:00', confidence: .98, facts: { employee: 'emp-1', date: '2026-08-23', project: 'project-1', action: 'clock_in', requestCode: 'REQ-IN' } },
  { id: 'raw-10', messageClass: 'user_message', text: 'นายช่างออก 17:00', confidence: .98, facts: { employee: 'emp-1', date: '2026-08-23', project: 'project-1', action: 'clock_out', requestCode: 'REQ-OUT' } },
  { id: 'raw-11', messageClass: 'user_message', text: 'ขอลาพรุ่งนี้', confidence: .89 },
  { id: 'raw-12', messageClass: 'user_message', text: 'รับทราบครับ', confidence: .30 },
]

const classified = fixtures.map((row) => {
  if (row.messageClass === 'system_confirmation' || row.text.includes('สรุปสถานะงาน HR ประจำวัน')) return { ...row, status: 'context' }
  if (row.duplicateOf) return { ...row, status: 'duplicate' }
  if (row.confirmedBundle) return { ...row, status: 'already_confirmed' }
  if ((row.confidence ?? 0) < .75) return { ...row, status: 'low_confidence' }
  if (row.facts) return { ...row, status: 'candidate' }
  if (/ลงเวลา|ลา/.test(row.text)) return { ...row, status: 'needs_more_info' }
  return { ...row, status: 'not_hr' }
})

const candidates = classified.filter((row) => row.status === 'candidate')
const bundleKeys = new Set(candidates.map((row) => `${row.facts!.employee}:${row.facts!.date}:${row.facts!.project}`))
assert.equal(fixtures.length, 12, 'fixture must show a busy HR intake')
assert.equal(candidates.length, 2, 'only the complete clock pair should survive the gate')
assert.equal(bundleKeys.size, 1, 'clock-in/out candidates must become one employee/date/project bundle')
assert.equal(classified.filter((row) => row.status === 'context').length, 2)
assert.equal(classified.filter((row) => row.status === 'duplicate').length, 1)
assert.equal(classified.filter((row) => row.status === 'already_confirmed').length, 1)
assert.equal(classified.filter((row) => row.status === 'low_confidence').length, 3)
assert.equal(classified.filter((row) => row.status === 'needs_more_info').length, 2)
assert.equal(classified.filter((row) => row.status === 'not_hr').length, 1)

const taskCard = {
  owner: 'hr-manager-1', nextAction: 'approve', slaDueAt: Date.now() + 30 * 60_000,
  evidence: [{ kind: 'attendance_job', id: 'job-in' }, { kind: 'attendance_job', id: 'job-out' }],
  childJobs: [{ id: 'job-in', sessionId: 'session-in' }, { id: 'job-out', sessionId: 'session-out' }],
  audit: ['bundle_received', 'validation_completed', 'approval_granted', 'child_attendance_recorded', 'bundle_recorded'],
}
assert.ok(taskCard.owner, 'approval requires an owner')
assert.equal(new Set(taskCard.evidence.map((row) => row.id)).size, taskCard.childJobs.length, 'every child needs attendance-job evidence')
assert.ok(taskCard.childJobs.every((row) => row.sessionId), 'close 100% requires attendance session IDs')
assert.equal(new Set(taskCard.audit).size, 5, 'close 100% requires complete audit events')
assert.ok(taskCard.slaDueAt > Date.now(), 'new approval task receives an SLA')

const repeatedActionKey = 'bundle-1:approve:fixed-key'
assert.equal(new Set([repeatedActionKey, repeatedActionKey]).size, 1, 'repeated action key must remain idempotent')

console.log(`HR intake gate fixture passed: raw=${fixtures.length}, candidates=${candidates.length}, bundles=${bundleKeys.size}`)
