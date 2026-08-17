import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110017_company_scoped_health_monitor.sql','utf8')
const edge=readFileSync('supabase/functions/health-monitor/index.ts','utf8')
const page=readFileSync('src/pages/SystemHealth/index.tsx','utf8')
const runner=readFileSync('src/components/HealthMonitorRunner.tsx','utf8')
const bootstrap=readFileSync('supabase/migrations/202608110027_health_monitor_company_bootstrap.sql','utf8')

for(const table of ['health_monitor_settings','health_monitor_checks','health_monitor_incidents','health_monitor_runs']){
  assert.match(migration,new RegExp(`${table} add column if not exists company_id`))
}
assert.match(migration,/health_monitor_checks_scope_key/)
assert.match(migration,/public\.is_company_manager\(company_id\)/)
assert.match(edge,/active_company_id/)
assert.match(edge,/Company manager permission required/)
assert.match(edge,/scope_key:actorCompanyId\?\?'global'/)
assert.match(edge,/onConflict:'scope_key,check_key'/)
assert.match(edge,/company_id:actorCompanyId,check_id:checkRow\.id/)
assert.match(page,/health_monitor_checks'[\s\S]*?\.eq\('company_id',companyId\)/)
assert.match(runner,/health_monitor_settings'[\s\S]*?\.eq\('company_id',currentCompany\?\.company_id/)
assert.match(bootstrap,/insert into public\.health_monitor_settings\([\s\S]*?line_group_id[\s\S]*?null/)
assert.match(bootstrap,/create or replace function public\.seed_company_singleton_settings\(\)/)
assert.match(bootstrap,/insert into health_monitor_settings/)
assert.match(page,/health_monitor_settings'[\s\S]*?\.maybeSingle\(\)/)
assert.match(edge,/Health Monitor settings are not initialized for the active company/)

console.log('TEN-010 company-scoped health monitor checks passed')
