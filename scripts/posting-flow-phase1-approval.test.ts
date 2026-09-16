import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  'supabase/migrations/202609160007_approve_posting_flow_phase1.sql',
  'utf8',
)

for (const required of [
  "wi.work_key = 'POSTING-FLOW-001'",
  "item.status <> 'ready'",
  "item.progress <> 0",
  'item.worker_id is not null',
  "item.approval_status <> 'pending'",
  "item.production_status <> 'backlog_registered'",
  "item.context_manifest ->> 'execution_phase' <> '1'",
  "item.context_manifest -> 'depends_on' <> '[]'::jsonb",
  'current_fingerprint := public.system_work_item_scope_fingerprint',
  "approval_status = 'approved'",
  "production_status = 'approved_for_execution'",
  "'phases_2_to_5', 'pending'",
]) {
  assert.ok(sql.includes(required), `missing Phase 1 approval guard: ${required}`)
}

for (const forbidden of [
  "where wi.work_key like 'POSTING%'",
  "work_key in ('POSTING-001'",
  "'execution_phase', 2",
  'force push',
]) {
  assert.ok(!sql.toLowerCase().includes(forbidden.toLowerCase()), `unsafe scope expansion: ${forbidden}`)
}

console.log('POSTING-FLOW-001 Phase 1 approval contract passed')
