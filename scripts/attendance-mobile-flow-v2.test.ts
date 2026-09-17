import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const edge=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
const ui=readFileSync('src/pages/TimeTracking/index.tsx','utf8')
const approvals=readFileSync('src/pages/Approvals/index.tsx','utf8')
const migration=readFileSync('supabase/migrations/202609170005_attendance_mobile_flow_v2.sql','utf8')
const flow=readFileSync('docs/TIME_TRACKING_FLOW.md','utf8')

for(const token of ['if (inaccurateGps)','หลักฐาน GPS หมดอายุ','if (outsideSite)','validateSelfie','exceptionRequestId','finalize_approved_attendance_exception']) assert.ok(edge.includes(token),`edge missing ${token}`)
assert.ok(edge.indexOf('if (inaccurateGps)')<edge.indexOf('if (outsideSite)'), 'accuracy must gate geofence')
for(const token of ['create_attendance_location_exception','requestOutsideException','ตรวจ GPS อีกครั้ง','approvedException','require_selfie','ยังไม่สร้าง Attendance','offlineAttendanceDraftKey','requiresFreshGps']) assert.ok(ui.includes(token),`UI missing ${token}`)
for(const token of ['review_attendance_location_exception','attendanceExceptions','ยังไม่ถูกนำไปคิดค่าแรง']) assert.ok(approvals.includes(token),`approval UI missing ${token}`)
for(const token of ['attendance_required_override','gps_evidence_ttl_seconds','self_approval_forbidden','idempotency_fingerprint_conflict','request_kind','attendance_recorded','num_nonnulls(session_id,request_id)=1','sealed_attendance_exception_evidence','selfie_not_found','selfie_retain_until','selfie_legal_hold_until']) assert.ok(migration.includes(token),`migration missing ${token}`)
assert.match(migration,/if request_accuracy_meters is null or request_accuracy_meters>/)
assert.match(migration,/if calculated_distance<=site\.radius_meters then raise exception 'location_is_inside_geofence'/)
assert.match(migration,/status='approved'/)
assert.match(migration,/attendance_session_id=created_id,status='attendance_recorded'/)
assert.ok(!migration.includes('drop table'), 'migration must be additive')
assert.match(flow,/Accuracy ต้องผ่านก่อนประเมิน Geofence/)
console.log('attendance mobile flow v2 contract passed')
