import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  new URL('../supabase/migrations/20260907143902_protect_monitoring_sentinel_work_items.sql', import.meta.url),
  'utf8',
)
const flow = readFileSync(new URL('../docs/SYSTEM_WORK_CLAIM_RECOVERY_FLOW.md', import.meta.url), 'utf8')

assert.match(migration, /create or replace function public\.recover_stale_system_work_items/)
assert.match(migration, /item\.status = 'doing'[\s\S]*coalesce\(item\.production_status, ''\) not like 'monitoring_active%'/)
assert.match(migration, /create or replace function public\.claim_system_work_item/)
assert.match(migration, /item\.status = 'ready'[\s\S]*coalesce\(item\.production_status, ''\) not like 'monitoring_active%'/)
assert.match(migration, /item\.attempt_count < max_attempts/)
assert.match(migration, /revoke all on function public\.claim_system_work_item\(text, integer, integer\) from public, anon, authenticated/)
assert.match(flow, /```mermaid/)
assert.match(flow, /SYS-004/)
assert.match(flow, /Health Monitor/)

console.log('SYS-004 monitoring sentinel recovery guard regression tests passed')
