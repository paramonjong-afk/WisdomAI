import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(new URL('../supabase/migrations/202608100012_communication_event_feed.sql', import.meta.url), 'utf8')
const repairMigration = readFileSync(new URL('../supabase/migrations/202608150019_system_health_runtime_repairs.sql', import.meta.url), 'utf8')
const healthMonitor = readFileSync(new URL('../supabase/functions/health-monitor/index.ts', import.meta.url), 'utf8')
const systemHealth = readFileSync(new URL('../src/pages/SystemHealth/index.tsx', import.meta.url), 'utf8')

assert.match(migration, /add column if not exists company_id uuid references public\.companies/, 'health notifications require a company boundary')
assert.match(migration, /create policy "Authorized users read health notifications"/, 'health notifications require an explicit tenant-aware read policy')
assert.match(migration, /company_id is not null and public\.is_company_manager\(company_id\)/, 'company logs must be restricted to company managers')
assert.match(migration, /company_id is null and exists\(select 1 from public\.profiles/, 'platform logs must be restricted to platform admins')
assert.match(migration, /create or replace view public\.communication_event_feed\s+with \(security_invoker=true\)/, 'the unified feed must honor source-table RLS')
for (const source of ['health_monitor_notifications','line_ingestion_events','telegram_admin_events','attendance_approval_events','system_work_item_events']) {
  assert.ok(migration.includes(`public.${source}`), `unified feed must include ${source}`)
}
assert.match(healthMonitor, /company_id: companyId \?\? chat\.company_id \?\? null/, 'new health notifications must retain company_id')
assert.doesNotMatch(migration, /security_definer/i, 'the log feed must not bypass tenant RLS')
assert.match(repairMigration, /create or replace function public\.get_communication_event_feed/)
assert.match(repairMigration, /if not public\.is_company_manager\(target_company_id\)/)
assert.match(repairMigration, /where event\.company_id=target_company_id/)
assert.match(repairMigration, /revoke all on function public\.get_communication_event_feed\(uuid,integer\) from public,anon/)
assert.match(systemHealth, /rpc\('get_communication_event_feed',\{target_company_id:companyId,target_limit:500\}\)/)

console.log('communication event feed tenant tests passed')
