import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const edge = readFileSync('supabase/functions/health-monitor/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/202608100011_secure_health_monitor_cron.sql', 'utf8')

assert.match(edge, /HEALTH_MONITOR_SECRET/)
assert.match(edge, /x-monitor-secret/)
assert.match(edge, /body\.source === 'pg_cron'[\s\S]*Valid company_id required for scheduled monitor/)
assert.match(edge, /body\.action === 'bootstrap_vault'/)
assert.match(edge, /bootstrap_health_monitor_vault_secret/)
assert.match(edge, /body\.source === 'pg_cron'/)
assert.match(edge, /\.eq\('work_key', 'SYS-002'\)/)
assert.match(edge, /deployed_cron_smoke_passed/)
assert.match(migration, /vault\.decrypted_secrets/)
assert.match(migration, /revoke all on function public\.bootstrap_health_monitor_vault_secret\(text\) from public, anon, authenticated/)
assert.match(migration, /grant execute on function public\.bootstrap_health_monitor_vault_secret\(text\) to service_role/)
assert.match(migration, /where name = 'health_monitor_secret'/)
assert.match(migration, /'\*\/5 \* \* \* \*'/)
assert.match(migration, /revoke all on function public\.invoke_health_monitor\(\) from public, anon, authenticated/)
assert.doesNotMatch(migration, /x-monitor-secret'\s*,\s*'[^']{32,}'/)

console.log('SYS-002 secure health monitor cron checks passed')
