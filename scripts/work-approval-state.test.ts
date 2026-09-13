import assert from 'node:assert/strict'
import { resolveApprovalState } from '../src/services/workApprovalState.ts'

const row = { work_key:'QA-DOC005-FULL-HARNESS-001', status:'approved' as const, decision_channel:'web', decision_reason:'ok', decision_by:null, decided_at:'2026-09-08T10:00:00Z', created_at:'2026-09-08T09:00:00Z', updated_at:'2026-09-08T10:00:00Z' }
const state = resolveApprovalState('pending', [row], row.work_key)
assert.equal(state.status, 'approved')
assert.equal(state.isReconciled, true)
assert.match(state.nextGate, /PR\/CI/)
console.log('work approval state tests passed')
