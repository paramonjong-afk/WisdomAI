import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608220001_hr_chat_work_event_stream.sql', 'utf8')
const chatFlow = readFileSync('docs/CHAT_ATTENDANCE_BRIDGE_FLOW.md', 'utf8')
const workforceFlow = readFileSync('docs/WORKFORCE_BACKBONE_FLOW.md', 'utf8')

const requiredSql = [
  'create table if not exists public.chat_hr_delivery_events',
  'create or replace function public.deliver_hr_work_chat_event',
  'create or replace function public.retry_failed_hr_chat_deliveries',
  'publish_leave_request_to_hr_chat_trigger',
  'publish_attendance_correction_to_hr_chat_trigger',
  'publish_overtime_assignment_to_hr_chat_trigger',
  'publish_document_request_to_hr_chat_trigger',
  'publish_lifecycle_case_to_hr_chat_trigger',
  'publish_resignation_to_hr_chat_trigger',
  "integration.integration_key = 'attendance'",
  'on conflict (company_id, event_key) do update',
  'sender_profile_id, message_type, text_content',
]

for (const needle of requiredSql) {
  if (!migration.includes(needle)) throw new Error(`missing SQL contract: ${needle}`)
}

const requiredSources = [
  'attendance_correction_requests',
  'employee_leave_requests',
  'employee_overtime_assignments',
  'employee_document_requests',
  'employee_lifecycle_cases',
  'employee_employment_records',
]

for (const source of requiredSources) {
  if (!migration.includes(source)) throw new Error(`missing HR source trigger/table: ${source}`)
  if (!chatFlow.includes(source)) throw new Error(`missing chat flow source: ${source}`)
}

if (migration.includes('to_jsonb(new)')) throw new Error('HR chat payload must not store full source rows')
if (migration.includes("'เหตุผล: '")) throw new Error('HR chat message must not expose sensitive free-text reasons')
if (migration.includes("'หมายเหตุ: '")) throw new Error('HR chat message must not expose sensitive free-text notes')
if (!chatFlow.includes('flowchart TD')) throw new Error('chat flow must begin with a renderable Mermaid flowchart')
if (!workforceFlow.includes('HR Chat Event Stream')) throw new Error('workforce flow missing HR chat event stream section')

console.log('hr chat work event stream contract checks passed')
