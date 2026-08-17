import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110012_telegram_attendance_approval.sql','utf8')
const fn=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')

assert.match(migration,/source in \('web','line_group','admin','telegram'\)/)
assert.match(migration,/review_telegram_attendance/)
assert.match(migration,/company_id=before_row\.company_id.*profile_id=actor_profile_id.*company_role in/s)
assert.match(migration,/attendance_already_decided/)
assert.match(migration,/attendance_approval_events/)
assert.match(migration,/grant execute on function public\.review_telegram_attendance\(uuid,uuid,text\) to service_role/)
assert.match(fn,/sendTelegramAttendanceApproval/)
assert.match(fn,/attendance:approve:/)
assert.match(fn,/attendance:request_more:/)
assert.match(fn,/attendance:reject:/)
assert.match(fn,/review_telegram_attendance/)
assert.match(fn,/\.eq\('company_id',companyId\)\.eq\('active',true\)/)
assert.match(fn,/sendPendingAttendanceApprovals/)
assert.match(fn,/command==='approvals'/)

console.log('telegram attendance approval tenant and callback checks passed')
