import assert from 'node:assert/strict'
import {
  canonicalStateFromLegacy,
  evaluateFilterTransition,
} from '../src/services/filterFlowContract.ts'

const base = {
  expectedVersion: 2,
  actualVersion: 2,
  eventKey: 'filter:doc-1:v2:route',
}

assert.equal(canonicalStateFromLegacy('received'), 'received_from_intake')
assert.equal(canonicalStateFromLegacy('ready_for_posting'), 'ready_for_accounting')
assert.equal(canonicalStateFromLegacy('approved_waiting_gateway'), 'posting')
assert.equal(canonicalStateFromLegacy('dismissed'), 'dead_letter')

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'received_from_intake',
  action: 'route_filter',
}), { kind: 'transition', nextState: 'validating', owner: 'filter' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'validating',
  action: 'request_correction',
}), { kind: 'transition', nextState: 'needs_correction', owner: 'filter' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'validating',
  action: 'ready_posting',
}), { kind: 'rejected', reason: 'accounting_document_required' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'validating',
  action: 'ready_posting',
  hasConfirmedAccountingDocument: true,
}), { kind: 'transition', nextState: 'ready_for_accounting', owner: 'accounting' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'awaiting_approval',
  action: 'approve',
  hasConfirmedAccountingDocument: true,
}), { kind: 'transition', nextState: 'posting', owner: 'posting' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'awaiting_approval',
  action: 'approve',
  hasConfirmedAccountingDocument: false,
}), { kind: 'rejected', reason: 'accounting_document_required' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'validating',
  action: 'route_filter',
  actualVersion: 3,
}), { kind: 'rejected', reason: 'version_conflict' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'validating',
  action: 'route_filter',
  existingEventKeys: new Set([base.eventKey]),
}), { kind: 'idempotent', nextState: 'validating' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'posted',
  action: 'retry',
}), { kind: 'rejected', reason: 'transition_not_allowed' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  currentState: 'failed',
  action: 'retry',
}), { kind: 'transition', nextState: 'validating', owner: 'filter' })

assert.deepEqual(evaluateFilterTransition({
  ...base,
  eventKey: ' ',
  currentState: 'validating',
  action: 'retry',
}), { kind: 'rejected', reason: 'event_key_required' })

console.log('filter flow contract checks passed')
