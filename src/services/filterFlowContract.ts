/**
 * Client-side preflight for the document-flow RPC. This improves action
 * availability in the UI, but never authorizes a workflow transition: the
 * security-definer RPC remains the tenant, role, approval, version, and audit
 * authority.
 */
export const documentFlowActions = [
  'route_filter',
  'request_classification',
  'request_correction',
  'ready_posting',
  'approve',
  'reject',
  'retry',
  'dead_letter',
  'recover',
] as const

export type DocumentFlowAction = (typeof documentFlowActions)[number]

export type DocumentFlowTransitionContext = {
  currentFlow: string
  state: string
  issueCodes?: readonly string[] | null
  duplicateState?: string | null
  routeTarget?: string | null
  accountingDocumentConfirmed?: boolean
  eventKey: string
}

export type DocumentFlowTransitionDecision = {
  allowed: boolean
  reason?: string
  nextFlow?: string
  nextState?: string
  nextRoom?: string
  serverAuthorizationRequired: true
  auditRequired: true
}

const denied = (reason: string): DocumentFlowTransitionDecision => ({
  allowed: false,
  reason,
  serverAuthorizationRequired: true,
  auditRequired: true,
})

const allowed = (nextFlow: string, nextState: string, nextRoom: string): DocumentFlowTransitionDecision => ({
  allowed: true,
  nextFlow,
  nextState,
  nextRoom,
  serverAuthorizationRequired: true,
  auditRequired: true,
})

const filterRoom = (routeTarget?: string | null) => `filter_${routeTarget || 'document_reference'}`

export const evaluateDocumentFlowTransition = (
  action: DocumentFlowAction,
  context: DocumentFlowTransitionContext,
): DocumentFlowTransitionDecision => {
  if (!context.eventKey.trim()) return denied('workflow_event_key_required')

  switch (action) {
    case 'route_filter':
      if (context.currentFlow !== 'intake'
        || (context.issueCodes?.length ?? 0) > 0
        || context.duplicateState === 'duplicate'
        || context.state === 'duplicate_hold') return denied('workflow_intake_quality_not_passed')
      return allowed('filter', 'validating', filterRoom(context.routeTarget))
    case 'request_classification':
      return allowed('intake', 'awaiting_classification', 'intake_manual_review')
    case 'request_correction':
      if (!['filter', 'posting'].includes(context.currentFlow)) return denied('workflow_transition_not_allowed')
      return allowed('filter', 'needs_correction', 'filter_correction_room')
    case 'ready_posting':
      if (context.currentFlow !== 'filter' || !context.accountingDocumentConfirmed) return denied('workflow_document_not_confirmed')
      return allowed('posting', 'awaiting_approval', 'posting_approval_room')
    case 'approve':
      if (context.currentFlow !== 'posting' || context.state !== 'awaiting_approval') return denied('workflow_transition_not_allowed')
      return allowed('posting', 'approved_waiting_gateway', 'posting_gateway_queue')
    case 'reject':
      if (!['filter', 'posting'].includes(context.currentFlow)) return denied('workflow_transition_not_allowed')
      return allowed(context.currentFlow, 'rejected', `${context.currentFlow}_rejected_room`)
    case 'retry':
      if (!['failed', 'rejected'].includes(context.state)) return denied('workflow_transition_not_allowed')
      if (context.currentFlow === 'posting') return allowed('posting', 'awaiting_approval', 'posting_approval_room')
      return allowed('filter', 'validating', filterRoom(context.routeTarget))
    case 'dead_letter':
      if (context.state === 'dismissed') return denied('workflow_transition_not_allowed')
      return allowed(context.currentFlow, 'dismissed', 'intake_dead_letter_room')
    case 'recover':
      if (context.state !== 'dismissed') return denied('workflow_transition_not_allowed')
      return allowed('intake', 'awaiting_classification', 'intake_manual_review')
  }
}
