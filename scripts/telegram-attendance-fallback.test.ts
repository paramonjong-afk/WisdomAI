import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608110008_telegram_attendance_fallback.sql','utf8')
const fn=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')

assert.match(migration,/finalize_telegram_attendance_request/)
assert.match(migration,/req\.requested_at < now\(\)-interval '10 minutes'/)
assert.match(migration,/req\.company_id.*req\.profile_id/s)
assert.match(migration,/site_not_in_request_company/)
assert.match(migration,/grant execute on function public\.finalize_telegram_attendance_request\(uuid\) to service_role/)
assert.match(migration,/Attendance selfies readable by tenant owner or manager/)
assert.match(fn,/latestTelegramAttendanceRequest/)
assert.match(fn,/\.eq\('company_id',actor\.company_id\)\.eq\('profile_id',actor\.profile_id\)/)
assert.match(fn,/attendance-selfies'\)\.upload\(selfiePath/)
assert.match(fn,/selfiePath=`\$\{actor\.profile_id\}\/telegram\/\$\{pending\.id\}\.jpg`/)
assert.match(fn,/message\?\.location\?'location':message\?\.photo\?\.length\?'photo'/)
assert.match(fn,/force_reply:true/)
assert.match(fn,/ไม่สามารถประมวลผลรายการได้/)

console.log('telegram attendance fallback security checks passed')
