import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
for(const table of ['company_members','employee_employment_records','attendance_system_settings','attendance_sessions','project_sites','employee_site_assignments','attendance_notifications']){
  assert.ok(source.includes(`from('${table}')`),`missing ${table} tenant flow`)
}
assert.match(source,/active_company_id/)
assert.match(source,/\.eq\('company_id', companyId\)/g)
assert.match(source,/company_id: companyId, profile_id: userId/)
assert.match(source,/company_id: companyId,[\s\S]*session_id: attendanceId/)
assert.match(source,/\.eq\('company_id', companyId\)\.eq\('id', open\.id\)/)
assert.match(source,/\.eq\('company_id', companyId\)\.eq\('id', body\.siteId\)/)
assert.match(source,/\.eq\('company_id', companyId\)\.eq\('profile_id', userId\)\.eq\('site_id', body\.siteId\)/)
console.log('TEN-001 attendance tenant edge checks passed')
