export const postingTargets = ['accounting', 'ap', 'stock', 'purchase_order'] as const

export type PostingTarget = (typeof postingTargets)[number]
export type PostingCommandKind = 'create' | 'reverse'

export type PostingPreview = {
  journalBalanced: boolean
  documentTotal: number
  journalDebitTotal: number
  journalCreditTotal: number
  taxTotal: number
  matchingPassed: boolean
  matchingReferences: readonly string[]
}

export type PostingApprovalSnapshot = {
  companyId: string
  intakeId: string
  documentId: string
  documentVersion: number
  snapshotHash: string
  filterDecision: 'passed' | 'failed'
  filterDecisionVersion: number
  preview: PostingPreview
  targets: readonly PostingTarget[]
  preparedBy: string
}

export type PostingApprovalRequest = {
  currentFlow: string
  currentState: string
  expectedDocumentVersion: number
  decisionAt: string
  approverId: string
  policyAuthorization: {
    allowed: boolean
    completed: boolean
    policyId?: string
    policyVersion?: number
    companyId?: string
    approverId?: string
    approvalRequestId?: string
    documentId?: string
    documentVersion?: number
    snapshotHash?: string
    finalStage?: number
    totalStages?: number
    authorizedAt?: string
    expiresAt?: string
    reason?: string
  }
  approvalEventKey: string
  finalValidationPassed: boolean
  commandKind?: PostingCommandKind
  originalOperationId?: string
  correctionOfDocumentId?: string
  snapshot: PostingApprovalSnapshot
}

export type PostingCommand = {
  contractVersion: '1'
  companyId: string
  intakeId: string
  documentId: string
  documentVersion: number
  postingType: PostingTarget
  commandKind: PostingCommandKind
  idempotencyKey: string
  approvalEventKey: string
  approvalSnapshotHash: string
  originalOperationId?: string
  correctionOfDocumentId?: string
}

export type PostingApprovalDecision = {
  allowed: boolean
  reason?: string
  nextState?: 'approved_waiting_gateway'
  nextRoom?: 'posting_gateway_queue'
  commands: readonly PostingCommand[]
  serverAuthorizationRequired: true
  atomicReservationRequired: true
  appendOnlyAuditRequired: true
}

const denied = (reason: string): PostingApprovalDecision => ({
  allowed: false,
  reason,
  commands: [],
  serverAuthorizationRequired: true,
  atomicReservationRequired: true,
  appendOnlyAuditRequired: true,
})

const keyPart = (value: string) => encodeURIComponent(value.trim().toLowerCase())

export const buildPostingIdempotencyKey = (
  snapshot: Pick<PostingApprovalSnapshot, 'companyId' | 'intakeId' | 'documentId'>,
  postingType: PostingTarget,
  commandKind: PostingCommandKind = 'create',
  originalOperationId?: string,
) => {
  const base = ['posting-v1', snapshot.companyId, snapshot.intakeId, snapshot.documentId, postingType]
    .map(keyPart)
    .join(':')
  return commandKind === 'reverse'
    ? `${base}:reversal:${keyPart(originalOperationId ?? '')}`
    : base
}

const requiredText = (value: string) => value.trim().length > 0
const finiteNonNegative = (value: number) => Number.isFinite(value) && value >= 0
const equalMoney = (left: number, right: number) => Math.abs(left - right) < 0.005

export const evaluatePostingApproval = (request: PostingApprovalRequest): PostingApprovalDecision => {
  const { snapshot } = request
  const decisionTime = Date.parse(request.decisionAt)
  if (request.currentFlow !== 'posting' || request.currentState !== 'awaiting_approval') {
    return denied('posting_transition_not_allowed')
  }
  if (snapshot.filterDecision !== 'passed') return denied('posting_filter_not_passed')
  if (snapshot.filterDecisionVersion < 1) return denied('posting_filter_decision_version_required')
  if (!requiredText(snapshot.companyId) || !requiredText(snapshot.intakeId) || !requiredText(snapshot.documentId)) {
    return denied('posting_source_identity_required')
  }
  if (!requiredText(snapshot.snapshotHash) || snapshot.documentVersion < 1) {
    return denied('posting_approval_snapshot_required')
  }
  if (request.expectedDocumentVersion !== snapshot.documentVersion) return denied('posting_snapshot_stale')
  if (!requiredText(request.approvalEventKey)) return denied('posting_approval_event_key_required')
  if (!requiredText(request.approverId) || !requiredText(snapshot.preparedBy)) return denied('posting_actor_identity_required')
  if (!request.policyAuthorization.allowed) return denied(request.policyAuthorization.reason ?? 'posting_approver_not_authorized')
  if (!request.policyAuthorization.completed) return denied('posting_approval_sequence_incomplete')
  if (request.policyAuthorization.companyId !== snapshot.companyId
    || request.policyAuthorization.approverId !== request.approverId
    || request.policyAuthorization.approvalRequestId !== request.approvalEventKey
    || request.policyAuthorization.documentId !== snapshot.documentId
    || request.policyAuthorization.documentVersion !== snapshot.documentVersion
    || request.policyAuthorization.snapshotHash !== snapshot.snapshotHash
    || request.policyAuthorization.finalStage !== request.policyAuthorization.totalStages
    || (request.policyAuthorization.finalStage ?? 0) < 1
    || !requiredText(request.policyAuthorization.policyId ?? '')
    || (request.policyAuthorization.policyVersion ?? 0) < 1) return denied('posting_policy_authorization_mismatch')
  const authorizedAt = Date.parse(request.policyAuthorization.authorizedAt ?? '')
  const expiresAt = Date.parse(request.policyAuthorization.expiresAt ?? '')
  if (!Number.isFinite(decisionTime) || !Number.isFinite(authorizedAt) || !Number.isFinite(expiresAt)
    || authorizedAt > decisionTime || decisionTime > expiresAt) return denied('posting_policy_authorization_expired')
  if (!request.finalValidationPassed) return denied('posting_final_validation_failed')
  if (snapshot.targets.length === 0
    || snapshot.targets.some((target) => !(postingTargets as readonly string[]).includes(target))
    || new Set(snapshot.targets).size !== snapshot.targets.length) {
    return denied('posting_targets_invalid')
  }
  const preview = snapshot.preview
  if (![preview.documentTotal, preview.journalDebitTotal, preview.journalCreditTotal, preview.taxTotal].every(finiteNonNegative)) {
    return denied('posting_preview_amount_invalid')
  }
  if (!preview.journalBalanced || !equalMoney(preview.journalDebitTotal, preview.journalCreditTotal)) {
    return denied('posting_journal_unbalanced')
  }
  if (!preview.matchingPassed) return denied('posting_matching_failed')

  const commandKind = request.commandKind ?? 'create'
  if (commandKind === 'reverse' && !requiredText(request.originalOperationId ?? '')) {
    return denied('posting_original_operation_required')
  }
  if (request.correctionOfDocumentId === snapshot.documentId) {
    return denied('posting_correction_requires_new_document_version')
  }

  const commands = snapshot.targets.map<PostingCommand>((postingType) => ({
    contractVersion: '1',
    companyId: snapshot.companyId,
    intakeId: snapshot.intakeId,
    documentId: snapshot.documentId,
    documentVersion: snapshot.documentVersion,
    postingType,
    commandKind,
    idempotencyKey: buildPostingIdempotencyKey(snapshot, postingType, commandKind, request.originalOperationId),
    approvalEventKey: request.approvalEventKey,
    approvalSnapshotHash: snapshot.snapshotHash,
    ...(request.originalOperationId ? { originalOperationId: request.originalOperationId } : {}),
    ...(request.correctionOfDocumentId ? { correctionOfDocumentId: request.correctionOfDocumentId } : {}),
  }))

  return {
    allowed: true,
    nextState: 'approved_waiting_gateway',
    nextRoom: 'posting_gateway_queue',
    commands,
    serverAuthorizationRequired: true,
    atomicReservationRequired: true,
    appendOnlyAuditRequired: true,
  }
}
