import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql=readFileSync(new URL('../supabase/migrations/202608100013_platform_admin_attendance_soft_delete.sql',import.meta.url),'utf8')
const report=readFileSync(new URL('../src/pages/Reports/index.tsx',import.meta.url),'utf8')

assert.match(sql,/actor\.role <> 'admin'/,'database must require platform admin')
assert.match(sql,/company_id=public\.current_company_id\(\)/,'RPC must remain in the active company')
assert.match(sql,/status='rejected',calculation_status='excluded'/,'soft delete must exclude attendance from calculations')
assert.match(sql,/platform_admin_soft_delete/,'soft delete must create an audit event')
assert.match(sql,/payroll_period_closed/,'closed payroll must block soft delete')
assert.match(sql,/active_session_exists_for_date/,'restore must prevent duplicate active attendance')
assert.match(report,/isPlatformAdmin as resolvePlatformAdmin/,'frontend must distinguish platform admin through the shared permission guard')
assert.match(report,/soft_delete_attendance_session/,'frontend must call the guarded RPC')
assert.match(report,/ยืนยันยกเลิกเคส/,'destructive action must require explicit confirmation')

console.log('attendance soft delete tests passed')
