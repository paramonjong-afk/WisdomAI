import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

const migration=readFileSync('supabase/migrations/202608110005_attendance_channel_identities.sql','utf8')
const telegram=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')

assert.match(migration,/unique\(company_id,channel,external_user_id\)/)
assert.match(migration,/profile_not_in_current_company/)
assert.match(migration,/public\.is_company_manager\(company\)/)
assert.match(migration,/link_attendance_channel_identity/)
assert.match(migration,/unlink_attendance_channel_identity/)
assert.match(telegram,/resolveAttendanceIdentity/)
assert.match(telegram,/\.eq\('channel','telegram'\)/)
assert.match(telegram,/บัญชี Telegram นี้ยังไม่มีตัวตนพนักงานที่ยืนยันในบริษัท/)
assert.match(telegram,/return json\(\{status:'attendance_request_received'\}\)/)
console.log('attendance channel identity isolation checks passed')
