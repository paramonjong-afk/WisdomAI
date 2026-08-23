import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823025922_web_chat_attendance_approval_jobs.sql', 'utf8')
const chat = fs.readFileSync('src/pages/Chat/index.tsx', 'utf8')

const checks: Array<[string, boolean]> = [
  ['normal path has explicit approval then real write', migration.includes("status='approved'") && migration.includes("insert into public.attendance_sessions") && migration.includes("status='recorded'")],
  ['idempotency uses company and request code', migration.includes('unique(company_id, request_code)') && migration.includes('request_code=trim(target_request_code)')],
  ['client retries recover the existing job instead of deleting its selfie', chat.includes('พบรหัสรายการเดิม ระบบไม่สร้าง Job ซ้ำ') && chat.includes('บันทึก Job สำเร็จแล้วจากรหัสรายการเดิม')],
  ['duplicate stays open for more information', migration.includes("'duplicate_detected'") && migration.includes("status='needs_more_info'")],
  ['employee name mismatch is blocked', migration.includes("raise exception 'employee_name_mismatch'")],
  ['clock out resolves and validates the open session site', migration.includes('resolved_site_id uuid := target_site_id') && migration.includes("missing_fields,'open_attendance_session'")],
  ['incomplete data goes to needs more information', migration.includes("cardinality(missing_fields)>0 then 'needs_more_info'")],
  ['reject and request more return to owner without close', migration.includes("review_action in ('reject','request_more')") && migration.includes('responsible_profile_id=job.requester_profile_id')],
  ['no response remains pending and UI warns', chat.includes("job.status === 'pending_approval' && waitingMinutes >= 30") && chat.includes('ไม่มีผู้ตอบ')],
  ['close 100 percent requires five audit events and recorded session', migration.includes('required_count<>5') && migration.includes("job.status<>'recorded'") && migration.includes("'job_closed_100_percent'")],
  ['manager actions are explicit buttons', chat.includes('อนุมัติและบันทึกจริง') && chat.includes('ขอข้อมูลเพิ่ม') && chat.includes('ตรวจครบและปิด Job 100%')],
  ['approval message records recipient and delivery state', migration.includes('message_status') && migration.includes('recipient_profile_id') && migration.includes("'send_failed'") && migration.includes('message_sent_at')],
  ['approval message carries required attendance facts and actions', migration.includes('ช่าง: ') && migration.includes('โครงการ/ไซต์:') && migration.includes('รหัสรายการ:') && migration.includes('Action: อนุมัติ · Reject · ขอข้อมูลเพิ่ม')],
  ['system confirmation is excluded from Omni intake', migration.includes("message_class='system_confirmation'") && migration.includes("add column if not exists message_class")],
  ['decision records claim and audit path', migration.includes('claimed_by') && migration.includes('claimed_at') && migration.includes('chat_attendance_approval_events')],
  ['Codex room is never a Web Chat destination', !migration.toLowerCase().includes('codex') && !chat.toLowerCase().includes('codex')],
]

for (const [name, passed] of checks) {
  if (!passed) throw new Error(`web chat attendance approval contract failed: ${name}`)
}

console.log(`web chat attendance approval checks passed (${checks.length})`)
