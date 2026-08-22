import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const migration = readFileSync('supabase/migrations/202608160027_document_flow_ledger.sql', 'utf8')
const page = readFileSync('src/pages/DocumentFlows/index.tsx', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')

for (const token of [
  'create table if not exists public.document_flow_items',
  'create table if not exists public.document_flow_events',
  'unique (company_id, intake_id)',
  'target_expected_version',
  'workflow_version_conflict',
  'target_event_key',
  'on conflict(event_key) do nothing',
  'approved_waiting_gateway',
  'public.sync_document_flow_item',
  'Managers read document flow items',
]) assert.ok(migration.includes(token), `missing ledger contract: ${token}`)

assert.ok(!migration.includes('insert into public.inventory_movements'), 'ledger must not post Stock')
assert.ok(!migration.includes('insert into public.accounting_draft_entries'), 'ledger must not post accounting')

for (const token of [
  'Timeline',
  'Version',
  'อนุมัติแล้ว—รอ Gateway',
]) assert.ok(page.includes(token), `missing control tower feature: ${token}`)

for (const token of [
  "from('document_flow_items')",
  "from('document_flow_events')",
  "rpc('transition_document_flow_item'",
  'target_expected_version',
  'target_event_key',
]) assert.ok(gateway.includes(token), `missing central gateway feature: ${token}`)

console.log('document flow ledger contract: ok')
