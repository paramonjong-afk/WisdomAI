import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608220002_omni_channel_intake_outtake.sql', 'utf8')
const flow = readFileSync('docs/OMNI_CHANNEL_INTAKE_OUTTAKE_FLOW.md', 'utf8')
const intakeFlow = readFileSync('docs/INTAKE_CASE_FLOW.md', 'utf8')
const registry = readFileSync('src/pages/FlowRegistry/index.tsx', 'utf8')
const reviewMigration = readFileSync('supabase/migrations/20260822192231_omni_intake_review_actions.sql', 'utf8')
const documentFlows = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const documentFlowGateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const hrChat = readFileSync('src/pages/Chat/index.tsx', 'utf8')
const senderlessWebChatMigration = readFileSync('supabase/migrations/20260822193341_web_chat_omni_intake_senderless_messages.sql', 'utf8')
const chatAttachmentPolicyMigration = readFileSync('supabase/migrations/20260822194037_chat_attachment_manager_storage_policy.sql', 'utf8')

const requiredSql = [
  'create table if not exists public.omni_channel_routes',
  'create table if not exists public.omni_intake_sources',
  'create table if not exists public.omni_filter_tasks',
  'create table if not exists public.omni_outtake_delivery_events',
  'create or replace function public.omni_analyze_conversation',
  'create or replace function public.omni_register_source',
  'create or replace function public.omni_register_line_message_trigger',
  'create or replace function public.omni_register_chat_message_trigger',
  'create trigger omni_register_line_message_after_insert',
  'create trigger omni_register_chat_message_after_insert',
  'content_fingerprint',
  'primary_source_id',
  "source_channel in ('line','web_chat','upload','manual')",
]

for (const needle of requiredSql) {
  if (!migration.includes(needle)) throw new Error(`missing omni SQL contract: ${needle}`)
}

for (const needle of ['LINE Intake', 'Web Chat Intake', 'Conversation Analyzer', 'เลือก primary source เดียว']) {
  if (!flow.includes(needle)) throw new Error(`missing omni flow detail: ${needle}`)
}

if (!intakeFlow.includes('Omni Intake Source Registry')) throw new Error('Intake flow must include Omni registry')
if (!registry.includes('Omni Channel Intake / OutTake')) throw new Error('Flow Registry must list Omni Channel flow')
if (!migration.includes("dedupe_status in ('primary','duplicate','possible_duplicate','context')")) throw new Error('dedupe states not enforced')
for (const needle of ['review_decision', 'omni_intake_review_events', 'review_omni_intake_source', 'omni_intake_review_permission_denied']) {
  if (!reviewMigration.includes(needle)) throw new Error(`missing omni review contract: ${needle}`)
}
for (const needle of ['ข้อความและบริบท', 'omni_filter', 'hr_confirmation', 'Summary/System', 'Duplicate/Confirmed', 'Not HR/Low confidence']) {
  if (!documentFlows.includes(needle)) throw new Error(`missing DocumentFlows omni/HR gate UI: ${needle}`)
}
for (const needle of ['loadOmniConversationContext', 'reviewOmniIntakeSource', "review_omni_intake_source"]) {
  if (!documentFlowGateway.includes(needle)) throw new Error(`missing Omni context/review gateway contract: ${needle}`)
}
for (const needle of ['ยืนยัน Candidate', 'ขอข้อมูลเพิ่ม', 'ปฏิเสธ', 'act_hr_intake_item']) {
  if (!hrChat.includes(needle)) throw new Error(`missing HR intake review action UI: ${needle}`)
}
if (senderlessWebChatMigration.includes('new.sender_profile_id is null or')) throw new Error('Web Chat Intake must not skip senderless messages')
for (const needle of ['omni_register_chat_message_trigger', "coalesce(sender_row.display_name, 'ไม่ระบุผู้ส่ง')", 'for chat_row in select * from public.chat_messages where deleted_at is null']) {
  if (!senderlessWebChatMigration.includes(needle)) throw new Error(`missing senderless Web Chat contract: ${needle}`)
}
for (const needle of ['Members and managers can view chat files', 'Members and managers can upload chat files', "bucket_id = 'chat-attachments'", 'public.is_company_manager']) {
  if (!chatAttachmentPolicyMigration.includes(needle)) throw new Error(`missing chat attachment manager policy: ${needle}`)
}

console.log('omni channel intake/outtake contract checks passed')
