import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110024_company_scheduled_health_monitor.sql','utf8')
const edge=readFileSync('supabase/functions/health-monitor/index.ts','utf8')
const page=readFileSync('src/pages/SystemHealth/index.tsx','utf8')

assert.match(migration,/for target in[\s\S]*health_monitor_settings[\s\S]*settings\.company_id is not null/)
assert.match(migration,/jsonb_build_object\('source','pg_cron','company_id',target\.company_id\)/)
assert.match(edge,/body\.source === 'pg_cron'[\s\S]*Valid company_id required for scheduled monitor/)
assert.match(edge,/actorCompanyId = requestedCompanyId/)
assert.match(page,/const load=useCallback\(async\(silent=false\)/)
assert.match(page,/status==='completed'\)\{void load\(true\)/)

console.log('Scheduled tenant monitor and silent refresh checks passed')
