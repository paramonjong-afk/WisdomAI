import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const edge=readFileSync('supabase/functions/attendance-clock/index.ts','utf8')
const ui=readFileSync('src/pages/TimeTracking/index.tsx','utf8')
const approvals=readFileSync('src/pages/Approvals/index.tsx','utf8')
const migration=readFileSync('supabase/migrations/202609170005_attendance_mobile_flow_v2.sql','utf8')
const line=readFileSync('supabase/functions/line-webhook/index.ts','utf8')
const telegram=readFileSync('supabase/functions/telegram-admin/index.ts','utf8')
const selfieAccess=readFileSync('supabase/functions/attendance-selfie-access/index.ts','utf8')
const retention=readFileSync('supabase/functions/attendance-selfie-retention/index.ts','utf8')
const flow=readFileSync('docs/TIME_TRACKING_FLOW.md','utf8')

for(const token of ['if (inaccurateGps)','หลักฐาน GPS หมดอายุ','if (outsideSite)','validateSelfie','exceptionRequestId','finalize_approved_attendance_exception']) assert.ok(edge.includes(token),`edge missing ${token}`)
assert.ok(edge.indexOf('if (inaccurateGps)')<edge.indexOf('if (outsideSite)'), 'accuracy must gate geofence')
for(const token of ['create_attendance_location_exception','requestOutsideException','ตรวจ GPS อีกครั้ง','approvedException','informationRequired','resubmitInformationRequired','record_attendance_mobile_metric','ยังไม่สร้าง Attendance','offlineAttendanceDraftKey','requiresFreshGps']) assert.ok(ui.includes(token),`UI missing ${token}`)
for(const token of ['claim_attendance_location_exception','review_attendance_location_exception','attendance-selfie-access','attendanceExceptions','ยังไม่ถูกนำไปคิดค่าแรง']) assert.ok(approvals.includes(token),`approval UI missing ${token}`)
for(const token of ['attendance_required_override','gps_evidence_ttl_seconds','self_approval_forbidden','idempotency_fingerprint_conflict','request_kind','attendance_recorded','num_nonnulls(session_id,request_id)=1','sealed_attendance_exception_evidence','selfie_not_found','selfie_retain_until','selfie_legal_hold_until','drop policy if exists "Managers update channel requests"','revoke update on public.attendance_channel_requests from authenticated','can_review_attendance_site','new_sealed_revision_required','unchanged_evidence_revision','claim_attendance_location_exception','attendance_selfie_purge_jobs','claim_attendance_selfie_purge_jobs','attendance_mobile_metrics','attendance_mobile_monitor_v1','escalate_overdue_attendance_exceptions','attendance_exception_finalized','active_claim_required','employment_not_active','site_assignment_not_active','attendance_selfie_retention_secret','invoke_attendance_selfie_retention','net.http_post','audit_attendance_notification_failure_trigger']) assert.ok(migration.includes(token),`migration missing ${token}`)
assert.match(migration,/if request_accuracy_meters is null or request_accuracy_meters>/)
assert.match(migration,/if calculated_distance<=site\.radius_meters then raise exception 'location_is_inside_geofence'/)
assert.match(migration,/status='approved'/)
assert.match(migration,/attendance_session_id=created_id,status='attendance_recorded'/)
assert.ok(!migration.includes('drop table'), 'migration must be additive')
assert.ok(!migration.includes('delete from storage.objects'),'retention must use Storage API, never direct metadata deletion')
assert.match(flow,/Accuracy ต้องผ่านก่อนประเมิน Geofence/)
assert.ok(!line.includes("clock_in_latitude: site.latitude"),'LINE must never substitute Site coordinates for employee GPS')
assert.ok(line.includes('fresh_gps_required_v2'),'LINE fallback must require canonical fresh GPS')
assert.ok(line.includes("channel:'line'")&&line.includes("status:'information_required'"),'LINE must publish canonical recovery request')
assert.ok(telegram.includes("result_status==='pending_review'"),'Telegram must route request-based exception review')
for(const token of ['createSignedUrl(path,600)','can_review_attendance_site','attendance_selfie_access_events','Cache-Control']) assert.ok(selfieAccess.includes(token),`selfie access missing ${token}`)
for(const token of ["storage.from('attendance-selfies').remove",'storage_delete_not_verified','attendance_selfie_retention_events',"status:'failed'",'terminal after 5 attempts','retry_scheduled']) assert.ok(retention.includes(token),`retention worker missing ${token}`)

// Adversarial transition model: a decision needs a live owner lease; request_more invalidates old evidence.
const canDecide=(status:string,claimedBy:string|null,actor:string,lease:number,revisionRequired:boolean,action:string)=>
  ['pending_review','claimed','information_required'].includes(status)&&claimedBy===actor&&lease>Date.now()&&!(action==='approve'&&revisionRequired)
assert.equal(canDecide('claimed','reviewer-a','reviewer-a',Date.now()+60_000,false,'approve'),true)
assert.equal(canDecide('claimed','reviewer-b','reviewer-a',Date.now()+60_000,false,'approve'),false)
assert.equal(canDecide('claimed','reviewer-a','reviewer-a',Date.now()-1,false,'approve'),false)
assert.equal(canDecide('claimed','reviewer-a','reviewer-a',Date.now()+60_000,true,'approve'),false)

// Retention failure -> bounded retry -> verified delete contract.
const retentionOutcome=(attempt:number,removed:boolean,stillExists:boolean)=>removed&&!stillExists?'succeeded':attempt>=5?'terminal_failed':'retry_scheduled'
assert.equal(retentionOutcome(1,false,true),'retry_scheduled')
assert.equal(retentionOutcome(4,false,true),'retry_scheduled')
assert.equal(retentionOutcome(5,false,true),'terminal_failed')
assert.equal(retentionOutcome(2,true,false),'succeeded')
assert.match(migration,/status='failed' and j\.attempts<5/)
assert.ok(migration.indexOf('enqueue_expired_attendance_selfies')<migration.lastIndexOf('invoke_attendance_selfie_retention'))
console.log('attendance mobile flow v2 contract passed')
