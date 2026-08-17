import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const migration=readFileSync('supabase/migrations/202608150008_company_member_workforce_role.sql','utf8')
const settings=readFileSync('src/pages/Settings/index.tsx','utf8')
const clock=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
assert.match(migration,/member_type in \('admin_only','employee','admin_employee'\)/)
assert.match(migration,/member\.member_type in \('employee','admin_employee'\)/)
assert.match(migration,/update_company_member_type/)
assert.match(migration,/company_member_type_audit/)
assert.match(settings,/นับเป็นพนักงานของบริษัท/)
assert.match(settings,/target_member_type:next/)
assert.match(clock,/membership\.member_type === 'admin_only'/)
console.log('company member workforce role checks passed')
