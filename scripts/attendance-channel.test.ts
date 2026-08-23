import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const migration=readFileSync('supabase/migrations/202608110002_attendance_channel_requests.sql','utf8')
const web=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
const telegram=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')

assert.match(migration,/create table if not exists public\.attendance_channel_requests/)
assert.match(migration,/company_id=public\.current_company_id\(\)/)
assert.match(migration,/site_not_in_current_company/)
assert.match(migration,/sync_line_attendance_channel_request_trigger/)
assert.match(migration,/revoke insert,delete on public\.attendance_channel_requests from anon,authenticated/)
assert.match(web,/attendance_channel_requests/)
assert.match(web,/external_event_id:`\$\{attendanceId\}:\$\{body\.action\}`/)
assert.match(telegram,/createTelegramAttendanceRequest/)
assert.match(telegram,/status:'information_required'/)
assert.match(telegram,/ระบบยังไม่สร้างเวลาจริงจนกว่าข้อมูลครบ/)
console.log('attendance channel tenant and intake checks passed')
