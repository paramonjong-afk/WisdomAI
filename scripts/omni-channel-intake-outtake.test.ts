import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608220002_omni_channel_intake_outtake.sql', 'utf8')
const flow = readFileSync('docs/OMNI_CHANNEL_INTAKE_OUTTAKE_FLOW.md', 'utf8')
const intakeFlow = readFileSync('docs/INTAKE_CASE_FLOW.md', 'utf8')
const registry = readFileSync('src/pages/FlowRegistry/index.tsx', 'utf8')

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

console.log('omni channel intake/outtake contract checks passed')
