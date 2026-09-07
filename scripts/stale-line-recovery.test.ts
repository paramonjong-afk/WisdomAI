import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260907044505_recover_stale_line_ingestion_events.sql', 'utf8')
const monitor = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')

assert.match(migration, /processing_status in \('received', 'processing'\)/)
assert.match(migration, /processed_at is null/)
assert.match(migration, /received_at < now\(\) - make_interval/)
assert.match(migration, /for update skip locked/)
assert.match(migration, /processing_stage = 'stale_recovered'/)
assert.match(migration, /raw message and attachments were retained/)
assert.match(migration, /limit target_limit/)
assert.match(migration, /revoke all on function public\.recover_stale_line_ingestion_events/)
assert.match(monitor, /admin\.rpc\('recover_stale_line_ingestion_events'/)
assert.match(monitor, /recovered_stale_events/)

console.log('stale LINE ingestion recovery contract passed')
