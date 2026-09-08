import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectApprovalLoop } from '../src/pages/WorkCommandCenter/approvalLoop.ts'

const firstLoop = detectApprovalLoop('DOC-INGEST-003', [
  { id: 1, old_status: 'ready', new_status: 'review', created_at: '2026-09-07T01:00:00Z' },
  { id: 2, old_status: 'review', new_status: 'ready', created_at: '2026-09-07T01:01:00Z' },
  { id: 3, old_status: 'ready', new_status: 'doing', created_at: '2026-09-07T01:02:00Z' },
  { id: 4, old_status: 'doing', new_status: 'review', created_at: '2026-09-07T01:03:00Z' },
])
assert.equal(firstLoop.detected, true)
assert.equal(firstLoop.rounds, 1)
assert.match(firstLoop.fingerprint ?? '', /^approval-loop:DOC-INGEST-003:1:/)

const reminderOnly = detectApprovalLoop('DOC-INGEST-004', [
  { id: 1, old_status: 'ready', new_status: 'review', created_at: '2026-09-07T01:00:00Z' },
  { id: 2, old_status: 'review', new_status: 'review', created_at: '2026-09-07T01:01:00Z' },
])
assert.equal(reminderOnly.detected, false)

const monitor = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')
const page = readFileSync('src/pages/WorkCommandCenter/index.tsx', 'utf8')
const detector = readFileSync('supabase/functions/_shared/approval-loop.ts', 'utf8')
assert.match(monitor, /function detectApprovalLoops/)
assert.match(monitor, /approval_loop_detected/)
assert.match(monitor, /import \{ detectApprovalLoop \} from '\.\.\/_shared\/approval-loop\.ts'/)
assert.match(detector, /approval-loop:\$\{workKey\}:\$\{rounds\}/)
assert.match(monitor, /item\.attempt_count >= maxAttempts/)
assert.match(monitor, /gte\('created_at', loop \? loop\.last_detected_at : since\(rateLimitMinutes\)\)/)
assert.match(monitor, /recordApprovalLoopEvidence/)
assert.match(monitor, /dedupe_key: dedupeKey/)
assert.match(monitor, /Cannot record monitor notification/)
assert.match(page, /detectApprovalLoop/)
assert.match(page, /ตรวจพบ Approval loop/)
assert.match(page, /approvalLoop\.nextAction/)
assert.match(page, /event\.event_type === "approval_loop_detected"/)

const migration = readFileSync('supabase/migrations/20260908093000_approval_loop_notification_evidence.sql', 'utf8')
assert.match(migration, /approval_loop_detected/)
assert.match(migration, /health_monitor_notification_dedupe_idx/)
assert.match(migration, /system_work_item_approval_loop_evidence_idx/)
console.log('approval loop detection contract checks passed')
