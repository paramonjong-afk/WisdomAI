import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/202609160008_approve_posting_phases_2_to_5.sql', 'utf8')
const keys = ['POSTING-001', 'POSTING-002', 'POSTING-004', 'POSTING-005', 'POSTING-008', 'FILTER-004', 'FILTER-007', 'FILTER-008']

for (const key of keys) assert.ok(sql.includes(`'${key}'`), `missing approved batch work key ${key}`)
for (const guard of [
  "item.status <> 'ready'",
  'item.worker_id is not null',
  "item.approval_status <> 'pending'",
  "item.production_status <> 'backlog_registered'",
  "'CTRL-POSTING-PHASE2-5-20260916'",
  "item.worker_outcome = 'completed'",
  "item.production_status = 'approved_for_execution'",
  "item.current_step = 'Phase 1 approved; waiting for an atomic Worker claim.'",
  "control_state = 'done'",
  "target.phase = 2 then 'ready' else 'blocked'",
  "target.phase = 2 then 'approved_for_execution' else 'approved_waiting_dependency'",
  'system_work_item_scope_fingerprint',
]) assert.ok(sql.includes(guard), `missing batch safety guard ${guard}`)

assert.equal((sql.match(/'POSTING-001'/g) ?? []).length, 1)
assert.equal((sql.match(/'POSTING-002'/g) ?? []).length, 1)
assert.ok(!sql.includes("status = 'ready',\n        production_status = 'approved_for_execution'"), 'must not release every phase')
console.log('Posting Phase 2-5 batch approval contract passed')
