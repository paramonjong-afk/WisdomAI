export type PostingApprovalStage = {
  stage: number
  role: string
  label: string
  delegationAllowed: boolean
}

export type PostingApprovalPolicy = {
  id: string
  version: number
  companyId: string
  documentTypes: readonly string[]
  projectIds?: readonly string[]
  minimumAmount: number
  maximumAmount?: number
  effectiveFrom: string
  effectiveUntil?: string
  approvalExpiresAfterHours: number
  stages: readonly PostingApprovalStage[]
}

export type PostingApprovalContext = {
  companyId: string
  documentType: string
  projectId?: string
  amount: number
  requestedAt: string
  preparedBy: string
  sourceOwnerId?: string
  approvalRequestId: string
  documentId: string
  documentVersion: number
  snapshotHash: string
}

export type PostingApprovalRecord = {
  policyId: string
  policyVersion: number
  companyId: string
  stage: number
  approverId: string
  delegatedFrom?: string
  approvedAt: string
}

export type PostingApprovalDelegation = {
  companyId: string
  principalId: string
  delegateId: string
  principalRoles: readonly string[]
  startsAt: string
  expiresAt: string
  policyId?: string
  stage?: number
}

export type PostingPolicyAuthorization = {
  allowed: boolean
  completed: boolean
  reason?: string
  policyId?: string
  policyVersion?: number
  companyId?: string
  approverId?: string
  stage?: number
  nextStage?: number
  delegatedFrom?: string
  authorizedAt?: string
  expiresAt?: string
  approvalRequestId?: string
  documentId?: string
  documentVersion?: number
  snapshotHash?: string
  finalStage?: number
  totalStages?: number
}

export type EvaluatePostingPolicyInput = {
  policies: readonly PostingApprovalPolicy[]
  context: PostingApprovalContext
  actor: { id: string; companyId: string; roles: readonly string[] }
  approvals: readonly PostingApprovalRecord[]
  now: string
  delegation?: PostingApprovalDelegation
}

const denied = (reason: string): PostingPolicyAuthorization => ({ allowed: false, completed: false, reason })
const validDate = (value: string) => Number.isFinite(Date.parse(value))
const includesNormalized = (values: readonly string[], value: string) => {
  const normalized = value.trim().toLowerCase()
  return values.some((entry) => entry.trim().toLowerCase() === normalized)
}

const validatePolicy = (policy: PostingApprovalPolicy) => {
  if (!policy.id.trim() || !policy.companyId.trim() || policy.version < 1) return false
  if (!Number.isFinite(policy.minimumAmount) || policy.minimumAmount < 0) return false
  if (policy.maximumAmount !== undefined && (!Number.isFinite(policy.maximumAmount) || policy.maximumAmount < policy.minimumAmount)) return false
  if (!validDate(policy.effectiveFrom) || (policy.effectiveUntil !== undefined && !validDate(policy.effectiveUntil))) return false
  if (policy.effectiveUntil !== undefined && Date.parse(policy.effectiveUntil) < Date.parse(policy.effectiveFrom)) return false
  if (!Number.isFinite(policy.approvalExpiresAfterHours) || policy.approvalExpiresAfterHours <= 0) return false
  if (policy.documentTypes.length === 0 || policy.stages.length === 0) return false
  return policy.stages.every((stage, index) => stage.stage === index + 1 && stage.role.trim().length > 0)
}

export const evaluatePostingApprovalPolicy = (input: EvaluatePostingPolicyInput): PostingPolicyAuthorization => {
  const { context, actor } = input
  const nowMs = Date.parse(input.now)
  const requestedMs = Date.parse(context.requestedAt)
  if (!Number.isFinite(nowMs) || !Number.isFinite(requestedMs)) return denied('posting_policy_time_invalid')
  if (requestedMs > nowMs) return denied('posting_policy_time_invalid')
  if (!context.companyId.trim() || !actor.companyId.trim() || actor.companyId !== context.companyId) {
    return denied('posting_policy_cross_tenant_denied')
  }
  if (!context.documentType.trim() || !Number.isFinite(context.amount) || context.amount < 0) {
    return denied('posting_policy_context_invalid')
  }
  if (!context.approvalRequestId.trim() || !context.documentId.trim()
    || !Number.isInteger(context.documentVersion) || context.documentVersion < 1
    || !context.snapshotHash.trim()) return denied('posting_policy_context_invalid')

  // Ignore policies that cannot govern this tenant/document/project. Once a
  // candidate is in scope, malformed definitions fail closed before ranking.
  const scopedCandidates = input.policies.filter((policy) => policy.companyId === context.companyId
    && includesNormalized(policy.documentTypes, context.documentType)
    && (!policy.projectIds?.length || (!!context.projectId && includesNormalized(policy.projectIds, context.projectId))))
  if (scopedCandidates.some((policy) => !validatePolicy(policy))) return denied('posting_policy_definition_invalid')

  const matches = scopedCandidates.filter((policy) => {
    const startsMs = Date.parse(policy.effectiveFrom)
    const endsMs = policy.effectiveUntil ? Date.parse(policy.effectiveUntil) : Number.POSITIVE_INFINITY
    return context.amount >= policy.minimumAmount
      && (policy.maximumAmount === undefined || context.amount <= policy.maximumAmount)
      && nowMs >= startsMs
      && nowMs <= endsMs
  })
  if (matches.length === 0) return denied('posting_policy_not_found')

  const ranked = matches
    .map((policy) => ({ policy, specificity: policy.projectIds?.length ? 1 : 0 }))
    .sort((left, right) => right.specificity - left.specificity || right.policy.version - left.policy.version)
  const selected = ranked[0]
  const equallySpecific = ranked.filter(({ policy, specificity }) => specificity === selected.specificity && policy.version === selected.policy.version)
  if (equallySpecific.length > 1) return denied('posting_policy_ambiguous')
  const policy = selected.policy

  const expiresMs = requestedMs + policy.approvalExpiresAfterHours * 60 * 60 * 1000
  if (nowMs > expiresMs) return denied('posting_approval_expired')
  if (input.approvals.length >= policy.stages.length) return denied('posting_approval_sequence_complete')

  const historicalApprovers = new Set<string>()
  let previousApprovalMs = requestedMs
  for (const [index, approval] of input.approvals.entries()) {
    if (approval.companyId !== context.companyId) return denied('posting_policy_cross_tenant_denied')
    if (approval.policyId !== policy.id || approval.policyVersion !== policy.version || approval.stage !== index + 1) {
      return denied('posting_approval_sequence_invalid')
    }
    const approvedMs = Date.parse(approval.approvedAt)
    if (!validDate(approval.approvedAt) || approvedMs < previousApprovalMs || approvedMs > nowMs || approvedMs > expiresMs) {
      return denied('posting_approval_history_invalid')
    }
    if (!approval.approverId.trim() || (approval.delegatedFrom !== undefined && !approval.delegatedFrom.trim())) {
      return denied('posting_approval_history_invalid')
    }
    if (historicalApprovers.has(approval.approverId)
      || (!!approval.delegatedFrom && historicalApprovers.has(approval.delegatedFrom))) {
      return denied('posting_separation_of_duties_violation')
    }
    historicalApprovers.add(approval.approverId)
    if (approval.delegatedFrom) historicalApprovers.add(approval.delegatedFrom)
    previousApprovalMs = approvedMs
  }

  const stage = policy.stages[input.approvals.length]
  const directRole = includesNormalized(actor.roles, stage.role)
  let delegatedFrom: string | undefined
  if (!directRole) {
    const delegation = input.delegation
    if (!stage.delegationAllowed || !delegation) return denied('posting_approver_role_required')
    const delegationStarts = Date.parse(delegation.startsAt)
    const delegationExpires = Date.parse(delegation.expiresAt)
    const delegationMatches = delegation.companyId === context.companyId
      && delegation.principalId.trim().length > 0
      && delegation.delegateId === actor.id
      && includesNormalized(delegation.principalRoles, stage.role)
      && (!delegation.policyId || delegation.policyId === policy.id)
      && (!delegation.stage || delegation.stage === stage.stage)
      && Number.isFinite(delegationStarts)
      && Number.isFinite(delegationExpires)
      && nowMs >= delegationStarts
      && nowMs <= delegationExpires
      && delegationExpires <= expiresMs
    if (!delegationMatches) return denied('posting_delegation_invalid_or_expired')
    delegatedFrom = delegation.principalId
  }

  const prohibitedActors = new Set([
    context.preparedBy,
    context.sourceOwnerId,
    ...input.approvals.flatMap((approval) => [approval.approverId, approval.delegatedFrom]),
  ].filter((value): value is string => Boolean(value)))
  if (prohibitedActors.has(actor.id) || (delegatedFrom && prohibitedActors.has(delegatedFrom))) {
    return denied('posting_separation_of_duties_violation')
  }

  const completed = stage.stage === policy.stages.length
  return {
    allowed: true,
    completed,
    policyId: policy.id,
    policyVersion: policy.version,
    companyId: context.companyId,
    approverId: actor.id,
    stage: stage.stage,
    ...(!completed ? { nextStage: stage.stage + 1 } : {}),
    ...(delegatedFrom ? { delegatedFrom } : {}),
    authorizedAt: input.now,
    expiresAt: new Date(expiresMs).toISOString(),
    approvalRequestId: context.approvalRequestId,
    documentId: context.documentId,
    documentVersion: context.documentVersion,
    snapshotHash: context.snapshotHash,
    ...(completed ? { finalStage: stage.stage, totalStages: policy.stages.length } : {}),
  }
}
