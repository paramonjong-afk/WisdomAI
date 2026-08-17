import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../supabase/functions/health-monitor/index.ts', import.meta.url), 'utf8')

assert.match(source, /\.eq\('status',\s*'failed'\)\.gte\('updated_at',\s*since\(24\s*\*\s*60\)\)/, 'failed notifications must be limited to the latest 24 hours')
assert.match(source, /\.is\('clock_out_at',\s*null\)\.lt\('clock_in_at',\s*since\(18\s*\*\s*60\)\)/, 'stale attendance sessions must remain limited to entries older than 18 hours')
assert.match(source, /failed_by_company: countByCompany/, 'failed notifications must be grouped by company in metadata')
assert.match(source, /stale_by_company: countByCompany/, 'stale sessions must be grouped by company in metadata')
assert.match(source, /stale_sessions: staleSessions/, 'stale sessions must expose resolved details instead of opaque ids')
assert.match(source, /employee_name: profile\?\.full_name/, 'stale session details must resolve the employee name')
assert.match(source, /project_name: project\?\.name/, 'stale session details must resolve the project name')
assert.match(source, /company_name: companies\.get/, 'stale session details must resolve the company name')
assert.doesNotMatch(source, /attendance_notifications'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('status', 'failed'\)/, 'health check must not count all historical failures')

console.log('health attendance warning tests passed')
