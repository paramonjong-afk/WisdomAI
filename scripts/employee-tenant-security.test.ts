import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const edge = readFileSync('supabase/functions/manage-employee/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/202608100003_tenant_safe_employee_lifecycle.sql', 'utf8')
const multiCompanyMigration = readFileSync('supabase/migrations/202608110015_multi_company_employment_records.sql', 'utf8')
const createEmployee = readFileSync('supabase/functions/create-employee/index.ts', 'utf8')
const employeePage = readFileSync('src/pages/Employee/index.tsx', 'utf8')
const reportsPage = readFileSync('src/pages/Reports/index.tsx', 'utf8')
const setupPage = readFileSync('src/pages/WorkforceSetup/index.tsx', 'utf8')

assert.match(edge, /user_company_preferences/)
assert.match(edge, /company_members/)
assert.match(edge, /company_admin','executive/)
assert.match(edge, /ไม่พบพนักงานในบริษัทปัจจุบัน/)
assert.match(edge, /otherMemberships/)
assert.doesNotMatch(edge, /ban_duration/)

assert.match(migration, /target_company_id uuid:=public\.current_company_id\(\)/)
assert.match(migration, /m\.company_id=target_company_id and m\.profile_id=auth\.uid\(\)/)
assert.match(migration, /m\.company_id=target_company_id and m\.profile_id=target_profile_id/)
assert.match(migration, /company_id=target_company_id/g)
assert.match(migration, /has_other_companies/)
assert.match(migration, /revoke all on function public\.employee_delete_preview\(uuid\) from public,anon/)
assert.match(migration, /revoke all on function public\.set_employee_active\(uuid,boolean,text\) from public,anon/)

assert.match(multiCompanyMigration, /primary key \(company_id, profile_id\)/)
assert.match(multiCompanyMigration, /on conflict\(company_id,profile_id\) do nothing/)
assert.match(createEmployee, /onConflict: 'company_id,profile_id'/)
assert.match(employeePage, /employee_employment_records'[\s\S]*?\.eq\('company_id',currentCompany\?\.company_id/)
assert.match(employeePage, /onConflict: 'company_id,profile_id'/)
assert.match(reportsPage, /employee_employment_records'[\s\S]*?\.eq\('company_id',companyId\)/)
assert.match(setupPage, /employee_employment_records'[\s\S]*?\.eq\('company_id',currentCompany\?\.company_id/)

console.log('employee tenant security tests passed')
