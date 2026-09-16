import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  evaluatePostingApprovalPolicy,
  type EvaluatePostingPolicyInput,
  type PostingApprovalPolicy,
} from '../src/services/postingApprovalPolicy.ts'

const policy: PostingApprovalPolicy = {
  id: 'company-1-invoice-project-a-100k',
  version: 1,
  companyId: 'company-1',
  documentTypes: ['supplier_invoice'],
  projectIds: ['project-a'],
  minimumAmount: 100_000,
  maximumAmount: 500_000,
  effectiveFrom: '2026-09-01T00:00:00.000Z',
  approvalExpiresAfterHours: 48,
  stages: [
    { stage: 1, role: 'project_manager', label: 'Project approval', delegationAllowed: true },
    { stage: 2, role: 'finance_manager', label: 'Finance approval', delegationAllowed: true },
  ],
}

const base: EvaluatePostingPolicyInput = {
  policies: [policy],
  context: {
    companyId: 'company-1',
    documentType: 'supplier_invoice',
    projectId: 'project-a',
    amount: 250_000,
    requestedAt: '2026-09-16T08:00:00.000Z',
    preparedBy: 'maker-1',
    sourceOwnerId: 'owner-1',
    approvalRequestId: 'approval-request-1',
    documentId: 'document-1',
    documentVersion: 7,
    snapshotHash: 'sha256:snapshot-1',
  },
  actor: { id: 'project-manager-1', companyId: 'company-1', roles: ['project_manager'] },
  approvals: [],
  now: '2026-09-16T09:00:00.000Z',
}

const first = evaluatePostingApprovalPolicy(base)
assert.equal(first.allowed, true)
assert.equal(first.completed, false)
assert.equal(first.stage, 1)
assert.equal(first.nextStage, 2)

const second = evaluatePostingApprovalPolicy({
  ...base,
  actor: { id: 'finance-manager-1', companyId: 'company-1', roles: ['finance_manager'] },
  approvals: [{
    policyId: policy.id,
    policyVersion: policy.version,
    companyId: 'company-1',
    stage: 1,
    approverId: 'project-manager-1',
    approvedAt: '2026-09-16T09:00:00.000Z',
  }],
  now: '2026-09-16T10:00:00.000Z',
})
assert.equal(second.allowed, true)
assert.equal(second.completed, true)
assert.equal(second.stage, 2)
assert.equal(second.approvalRequestId, base.context.approvalRequestId)
assert.equal(second.documentId, base.context.documentId)
assert.equal(second.documentVersion, base.context.documentVersion)
assert.equal(second.snapshotHash, base.context.snapshotHash)
assert.equal(second.finalStage, 2)
assert.equal(second.totalStages, 2)

assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  actor: { ...base.actor, companyId: 'company-2' },
}).reason, 'posting_policy_cross_tenant_denied')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  context: { ...base.context, amount: 99_999 },
}).reason, 'posting_policy_not_found')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  actor: { ...base.actor, id: 'maker-1' },
}).reason, 'posting_separation_of_duties_violation')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  actor: { id: 'finance-manager-1', companyId: 'company-1', roles: ['finance_manager'] },
}).reason, 'posting_approver_role_required')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  now: '2026-09-19T09:00:00.000Z',
}).reason, 'posting_approval_expired')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  approvals: [{
    policyId: policy.id,
    policyVersion: policy.version,
    companyId: 'company-1',
    stage: 2,
    approverId: 'finance-manager-1',
    approvedAt: '2026-09-16T08:30:00.000Z',
  }],
}).reason, 'posting_approval_sequence_invalid')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  now: '2026-09-16T07:00:00.000Z',
}).reason, 'posting_policy_time_invalid')

const threeStagePolicy: PostingApprovalPolicy = {
  ...policy,
  id: 'company-1-three-stage',
  stages: [
    ...policy.stages,
    { stage: 3, role: 'director', label: 'Director approval', delegationAllowed: false },
  ],
}
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  policies: [threeStagePolicy],
  actor: { id: 'director-1', companyId: 'company-1', roles: ['director'] },
  approvals: [
    { policyId: threeStagePolicy.id, policyVersion: 1, companyId: 'company-1', stage: 1, approverId: 'same-approver', approvedAt: '2026-09-16T08:30:00.000Z' },
    { policyId: threeStagePolicy.id, policyVersion: 1, companyId: 'company-1', stage: 2, approverId: 'same-approver', approvedAt: '2026-09-16T08:45:00.000Z' },
  ],
}).reason, 'posting_separation_of_duties_violation')

const delegated = evaluatePostingApprovalPolicy({
  ...base,
  actor: { id: 'delegate-1', companyId: 'company-1', roles: [] },
  delegation: {
    companyId: 'company-1',
    principalId: 'project-manager-2',
    delegateId: 'delegate-1',
    principalRoles: ['project_manager'],
    startsAt: '2026-09-16T08:00:00.000Z',
    expiresAt: '2026-09-17T08:00:00.000Z',
    policyId: policy.id,
    stage: 1,
  },
})
assert.equal(delegated.allowed, true)
assert.equal(delegated.delegatedFrom, 'project-manager-2')

assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  actor: { id: 'delegate-1', companyId: 'company-1', roles: [] },
  delegation: {
    companyId: 'company-1',
    principalId: 'project-manager-2',
    delegateId: 'delegate-1',
    principalRoles: ['project_manager'],
    startsAt: '2026-09-14T08:00:00.000Z',
    expiresAt: '2026-09-15T08:00:00.000Z',
  },
}).reason, 'posting_delegation_invalid_or_expired')

const malformedOtherTenant = { ...policy, id: '', companyId: 'company-2', stages: [] }
const malformedOtherDocument = { ...policy, id: '', documentTypes: ['credit_note'], stages: [] }
assert.equal(evaluatePostingApprovalPolicy({ ...base, policies: [malformedOtherTenant, malformedOtherDocument, policy] }).allowed, true)
assert.equal(evaluatePostingApprovalPolicy({ ...base, policies: [{ ...policy, id: '', stages: [] }] }).reason, 'posting_policy_definition_invalid')

const delegatedStageOne = {
  policyId: threeStagePolicy.id,
  policyVersion: 1,
  companyId: 'company-1',
  stage: 1,
  approverId: 'delegate-1',
  delegatedFrom: 'principal-1',
  approvedAt: '2026-09-16T08:30:00.000Z',
}
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  policies: [threeStagePolicy],
  actor: { id: 'principal-1', companyId: 'company-1', roles: ['finance_manager'] },
  approvals: [delegatedStageOne],
}).reason, 'posting_separation_of_duties_violation')
assert.equal(evaluatePostingApprovalPolicy({
  ...base,
  policies: [threeStagePolicy],
  actor: { id: 'delegate-1', companyId: 'company-1', roles: ['finance_manager'] },
  approvals: [delegatedStageOne],
}).reason, 'posting_separation_of_duties_violation')

const flow = readFileSync('docs/POSTING_APPROVAL_TRANSACTION_CONTRACT.md', 'utf8')
for (const term of ['company', 'document type', 'project', 'amount', 'segregation-of-duties', 'delegation', 'expiry', 'strict stage order']) {
  assert.match(flow, new RegExp(term, 'i'), `Posting Flow must define ${term}`)
}

console.log('Posting approval policy positive, negative, delegation, ordering, and cross-tenant checks passed')
