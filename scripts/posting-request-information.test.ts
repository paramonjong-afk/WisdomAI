import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateDocumentFlowTransition } from '../src/services/filterFlowContract.ts'

const migration = readFileSync('supabase/migrations/202609160009_posting_request_information.sql', 'utf8')
const router = readFileSync('src/router/index.tsx', 'utf8')

const requested = evaluateDocumentFlowTransition('request_information', {
  currentFlow: 'posting', state: 'awaiting_approval', eventKey: 'request-1',
})
assert.equal(requested.nextState, 'information_requested')
assert.equal(requested.nextRoom, 'posting_source_information_room')
assert.equal(evaluateDocumentFlowTransition('request_information', {
  currentFlow: 'posting', state: 'information_requested', eventKey: 'request-2',
}).allowed, false)
assert.equal(evaluateDocumentFlowTransition('resubmit_information', {
  currentFlow: 'posting', state: 'information_requested', eventKey: 'resubmit-1',
}).nextState, 'awaiting_approval')

for (const invariant of [
  "when 'request_information'", "when 'resubmit_information'", 'workflow_reason_required',
  'workflow_information_owner_required', 'workflow_information_owner_missing',
  'document.created_by', 'before_row.assigned_to', "'posting_side_effects',false",
  'insert into public.document_flow_events', 'item.id=target_item_id',
  'replay_row.company_id=public.current_company_id()', 'information_owner_id=auth.uid()',
]) assert.ok(migration.includes(invariant), `missing request-information invariant: ${invariant}`)

assert.doesNotMatch(migration, /insert into public\.(?:accounting_draft_entries|posting_operations|inventory_movements|purchase_orders)/i)
assert.match(router, /document-flows\/source-information.*DocumentFlowsPage/)
console.log('posting request-information contracts passed')
