import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260909114055_work_command_center_continuous_dispatch.sql', 'utf8')
const monitor = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')
const page = readFileSync('src/pages/WorkCommandCenter/index.tsx', 'utf8')

assert.match(migration, /create table public\.system_work_dispatch_intents/)
assert.match(migration, /unique \(work_key, intent_kind\)/)
assert.match(migration, /enable row level security/)
assert.match(migration, /revoke all on public\.system_work_dispatch_intents from anon, authenticated/)
assert.match(migration, /dispatch_intent_created/)
assert.match(migration, /revoke all on function public\.audit_system_work_dispatch_intent_change\(\) from public, anon, authenticated/)

assert.match(monitor, /async function reconcileContinuousWorkDispatch/)
assert.match(monitor, /system_worker_runs.*heartbeat_at/s)
assert.match(monitor, /zero_active_dispatch_intents_created/)
assert.match(monitor, /onConflict: 'work_key,intent_kind'/)
assert.match(monitor, /next_gate: 'explicit_approval'/)
assert.match(monitor, /next_gate: 'root_cause_and_controlled_retry'/)
assert.match(monitor, /do not auto-retry/)

assert.match(page, /system_work_dispatch_intents/)
assert.match(page, /ไม่พบ Worker ที่มี lease สด/)
assert.match(page, /Dispatch Intent/)
// The local hasActiveClaim duplicate (with its own buggy 10-minute heartbeat
// cutoff) was removed during the PR #78 merge in favor of the shared,
// already-fixed hasActiveWorkerClaim from src/services/workClaimStatus.ts --
// see work-claim-status.test.ts for the fake-clock label coverage.
assert.doesNotMatch(page, /const hasActiveClaim\b/)
assert.match(page, /hasActiveWorkerClaim/)

console.log('continuous dispatch handoff, approval gate, zero-active, and audit/RLS checks passed')
