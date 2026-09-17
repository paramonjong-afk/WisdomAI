import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration=readFileSync('supabase/migrations/202608100014_attendance_session_validation.sql','utf8')
const clock=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
const line=readFileSync('supabase/functions/line-webhook/index.ts','utf8')

assert.match(migration,/max_shift_minutes integer not null default 720/)
assert.match(migration,/allow_overnight_shifts boolean not null default false/)
assert.match(migration,/new\.worked_minutes := null/)
assert.match(migration,/new\.calculation_status := 'needs_review'/)
assert.match(migration,/at time zone 'Asia\/Bangkok'/)
assert.match(migration,/where company_id = new\.company_id and singleton = true/)
assert.match(migration,/ATT-VALIDATE-001/)

assert.match(clock,/if \(!existingIsToday\)/)
assert.match(clock,/review_category: 'missing_clock_out'/)
assert.match(clock,/elapsedMinutes > maxShiftMinutes/)
assert.match(clock,/crossesBusinessDate && !allowOvernightShifts/)
assert.match(clock,/\.eq\('company_id', companyId\)\.eq\('id', open\.id\)/)

assert.match(line,/fresh_gps_required_v2/)
assert.match(line,/ระบบห้ามใช้พิกัด Site แทนพิกัดพนักงาน/)
assert.doesNotMatch(line,/clock_in_latitude: site\.latitude/)

console.log('attendance session validation regression passed')
