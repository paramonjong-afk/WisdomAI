import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { evaluateDocumentFlowTransition } from '../src/services/filterFlowContract.ts'

const migration = readFileSync('supabase/migrations/202608190008_document_flow_intake_quality_and_facets.sql', 'utf8')
const gateway = readFileSync('src/services/documentFlowGateway.ts', 'utf8')
const intakeRoom = readFileSync('src/pages/IntakeRoom.tsx', 'utf8')

const base = { currentFlow: 'intake', state: 'received', eventKey: 'event-1' }

assert.equal(evaluateDocumentFlowTransition('route_filter', base).allowed, true)
assert.equal(evaluateDocumentFlowTransition('route_filter', { ...base, issueCodes: ['missing_vendor'] }).reason, 'workflow_intake_quality_not_passed')
assert.equal(evaluateDocumentFlowTransition('route_filter', { ...base, duplicateState: 'duplicate' }).reason, 'workflow_intake_quality_not_passed')
assert.equal(evaluateDocumentFlowTransition('retry', base).allowed, false)
assert.equal(evaluateDocumentFlowTransition('retry', { ...base, state: 'rejected' }).nextState, 'validating')
assert.equal(evaluateDocumentFlowTransition('recover', { ...base, state: 'dismissed', currentFlow: 'filter' }).nextState, 'awaiting_classification')
assert.equal(evaluateDocumentFlowTransition('approve', { ...base, currentFlow: 'posting', state: 'awaiting_approval' }).nextRoom, 'posting_gateway_queue')
assert.equal(evaluateDocumentFlowTransition('ready_posting', { ...base, currentFlow: 'filter', accountingDocumentConfirmed: false }).reason, 'workflow_document_not_confirmed')
assert.equal(evaluateDocumentFlowTransition('dead_letter', { ...base, state: 'dismissed' }).allowed, false)

for (const action of ['route_filter', 'request_classification', 'request_correction', 'ready_posting', 'approve', 'reject', 'retry', 'dead_letter', 'recover']) {
  assert.match(migration, new RegExp(`when '${action}'`), `RPC must support ${action}`)
}
for (const invariant of ['public.is_platform_admin()', 'public.current_company_id()', 'public.is_company_manager', "status='confirmed'", "insert into public.document_flow_events", 'event_key=target_event_key']) {
  assert.ok(migration.includes(invariant), `RPC must retain ${invariant}`)
}
assert.match(gateway, /evaluateDocumentFlowTransition/)
assert.match(gateway, /transitionWithContract/)
assert.match(intakeRoom, /transitionWithContract/)
assert.match(intakeRoom, /duplicate_state\?: string \| null/)
assert.match(intakeRoom, /duplicateState: item\.duplicate_state/)
assert.match(intakeRoom, /item\.duplicate_state === 'duplicate'/)
assert.match(intakeRoom, /selectedItem\.duplicate_state === 'duplicate'/)

console.log('filter runtime contract checks passed')
