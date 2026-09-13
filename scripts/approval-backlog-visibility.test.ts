import assert from 'node:assert/strict'
import { resolveApprovalState } from '../src/services/workApprovalState.ts'
import { displayProgress, isInternalControl, workLane } from '../src/services/workBacklogProjection.ts'

const approved = { work_key:'LEGACY-APPROVED', status:'approved' as const, decision_channel:'web', decision_reason:'ok', decision_by:null, decided_at:'2026-09-09T00:00:00Z', created_at:'2026-09-08T00:00:00Z', updated_at:'2026-09-09T00:00:00Z' }
assert.equal(resolveApprovalState('pending',[approved],approved.work_key).status,'approved')
assert.equal(resolveApprovalState('pending',[approved],approved.work_key).isReconciled,true)
assert.equal(resolveApprovalState('pending',[], 'LEGACY-PENDING').status,'pending')
assert.equal(resolveApprovalState('rejected',[], 'LEGACY-REJECTED').nextGate,'ต้องแก้ไขและส่งขออนุมัติใหม่')
assert.equal(displayProgress('review',100),95)
assert.equal(displayProgress('done',100),100)
assert.equal(workLane('review','source_ready_not_deployed',null),'QA')
assert.equal(workLane('review','awaiting_pr_ci',null),'Release')
assert.equal(isInternalControl('CONTROL-DEPUTY-EXAMPLE'),true)
console.log('approval backlog visibility/persistence contract passed')
