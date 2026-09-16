import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildPostingIdempotencyKey, evaluatePostingApproval, type PostingApprovalRequest } from '../src/services/postingFlowContract.ts'

const base: PostingApprovalRequest = {
  currentFlow: 'posting',
  currentState: 'awaiting_approval',
  expectedDocumentVersion: 7,
  approverId: 'approver-1',
  approverAuthorized: true,
  separationOfDutiesRequired: true,
  approvalEventKey: 'approval:event:1',
  finalValidationPassed: true,
  snapshot: {
    companyId: 'company-1',
    intakeId: 'intake-1',
    documentId: 'document-1',
    documentVersion: 7,
    snapshotHash: 'sha256:approval-snapshot',
    filterDecision: 'passed',
    filterDecisionVersion: 3,
    preview: {
      journalBalanced: true,
      documentTotal: 107,
      journalDebitTotal: 107,
      journalCreditTotal: 107,
      taxTotal: 7,
      matchingPassed: true,
      matchingReferences: ['po-1', 'receipt-1'],
    },
    targets: ['accounting', 'ap', 'stock'],
    preparedBy: 'maker-1',
  },
}

const approved = evaluatePostingApproval(base)
assert.equal(approved.allowed, true)
assert.equal(approved.nextState, 'approved_waiting_gateway')
assert.equal(approved.commands.length, 3)
assert.equal(new Set(approved.commands.map((command) => command.idempotencyKey)).size, 3)
assert.equal(approved.commands[0].approvalSnapshotHash, base.snapshot.snapshotHash)

assert.equal(evaluatePostingApproval({ ...base, currentFlow: 'filter' }).reason, 'posting_transition_not_allowed')
assert.equal(evaluatePostingApproval({ ...base, snapshot: { ...base.snapshot, filterDecision: 'failed' } }).reason, 'posting_filter_not_passed')
assert.equal(evaluatePostingApproval({ ...base, expectedDocumentVersion: 6 }).reason, 'posting_snapshot_stale')
assert.equal(evaluatePostingApproval({ ...base, approverAuthorized: false }).reason, 'posting_approver_not_authorized')
assert.equal(evaluatePostingApproval({ ...base, approverId: '' }).reason, 'posting_actor_identity_required')
assert.equal(evaluatePostingApproval({ ...base, approverId: 'maker-1' }).reason, 'posting_separation_of_duties_violation')
assert.equal(evaluatePostingApproval({ ...base, finalValidationPassed: false }).reason, 'posting_final_validation_failed')
assert.equal(evaluatePostingApproval({ ...base, snapshot: { ...base.snapshot, targets: ['ap', 'ap'] } }).reason, 'posting_targets_invalid')
assert.equal(evaluatePostingApproval({ ...base, snapshot: { ...base.snapshot, targets: ['unknown'] as never } }).reason, 'posting_targets_invalid')
assert.equal(evaluatePostingApproval({ ...base, snapshot: { ...base.snapshot, preview: { ...base.snapshot.preview, journalCreditTotal: 106 } } }).reason, 'posting_journal_unbalanced')
assert.equal(evaluatePostingApproval({ ...base, snapshot: { ...base.snapshot, preview: { ...base.snapshot.preview, matchingPassed: false } } }).reason, 'posting_matching_failed')
assert.equal(evaluatePostingApproval({ ...base, commandKind: 'reverse' }).reason, 'posting_original_operation_required')
assert.equal(evaluatePostingApproval({ ...base, correctionOfDocumentId: 'document-1' }).reason, 'posting_correction_requires_new_document_version')

const key = buildPostingIdempotencyKey(base.snapshot, 'accounting')
assert.equal(key, buildPostingIdempotencyKey(base.snapshot, 'accounting'))
assert.notEqual(key, buildPostingIdempotencyKey(base.snapshot, 'ap'))
assert.match(buildPostingIdempotencyKey(base.snapshot, 'accounting', 'reverse', 'operation-1'), /:reversal:operation-1$/)

const flowDoc = readFileSync('docs/POSTING_APPROVAL_TRANSACTION_CONTRACT.md', 'utf8')
for (const heading of ['Inputs and outputs', 'States and transitions', 'Roles and permissions', 'Failure, retry and recovery', 'Audit events', 'Owner', 'Change record']) {
  assert.ok(flowDoc.includes(heading), `Flow document must include ${heading}`)
}
for (const invariant of ['FILTER-007', 'FILTER-008', 'approval snapshot', 'idempotency', 'correction', 'reversal']) {
  assert.match(flowDoc, new RegExp(invariant, 'i'), `Flow document must define ${invariant}`)
}

console.log('posting flow phase 1 contract checks passed')
