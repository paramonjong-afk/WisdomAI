import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../supabase/migrations/20260911150000_pr77_sys004_sentinel_fix.sql', import.meta.url),
  'utf8',
)
const flow = readFileSync(new URL('../docs/SYSTEM_WORK_CLAIM_RECOVERY_FLOW.md', import.meta.url), 'utf8')
const hardening = readFileSync(
  new URL('../supabase/migrations/202609160004_sys004_monitoring_sentinel_hardening.sql', import.meta.url),
  'utf8',
)
const monitor = readFileSync(new URL('../supabase/functions/health-monitor/index.ts', import.meta.url), 'utf8')
const worker = readFileSync(new URL('../supabase/functions/automation-worker/index.ts', import.meta.url), 'utf8')
const commandCenter = readFileSync(new URL('../src/pages/WorkCommandCenter/index.tsx', import.meta.url), 'utf8')

assert.match(migration, /create or replace function public\.recover_stale_system_work_items/)
assert.match(migration, /item\.status = 'doing'[\s\S]*coalesce\(item\.production_status, ''\) not like 'monitoring_active%'/)
assert.match(migration, /create or replace function public\.claim_system_work_item/)
assert.match(migration, /item\.status = 'ready'[\s\S]*coalesce\(item\.production_status, ''\) not like 'monitoring_active%'/)
assert.match(migration, /item\.attempt_count < max_attempts/)
assert.match(migration, /revoke all on function public\.claim_system_work_item\(text, integer, integer\) from public, anon, authenticated/)
assert.match(flow, /```mermaid/)
assert.match(flow, /SYS-004/)
assert.match(flow, /Health Monitor/)

assert.match(hardening, /work_kind in \('executable','monitoring_sentinel'\)/)
assert.match(hardening, /item\.status='ready' and item\.work_kind='executable'/)
assert.match(hardening, /attempt_count=0[\s\S]*worker_outcome=null/)
assert.match(hardening, /monitoring_sentinel_hardened/)
assert.doesNotMatch(hardening, /delete\s+from|truncate\s+table|drop\s+table/i)
assert.match(monitor, /monitor_state:/)
assert.match(monitor, /monitor_evidence:/)
assert.doesNotMatch(monitor, /[\r\n]+\s*evidence: evidence\.slice/)
assert.match(worker, /active_runs: liveRuns/)
assert.match(worker, /run_history: runHistory/)
assert.match(worker, /actionable_counts: actionableCounts/)
assert.match(commandCenter, /isMonitoringSentinel/)
assert.match(commandCenter, /ยังไม่มี Token telemetry จาก Worker/)
assert.match(commandCenter, /ระบบ Monitor/)
assert.match(commandCenter, /แยกจากสถิติ Worker และงานที่ต้องลงมือ/)

console.log('SYS-004 monitoring sentinel recovery guard regression tests passed')
