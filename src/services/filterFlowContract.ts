export type LegacyFilterState =
  | 'received'
  | 'validating'
  | 'needs_correction'
  | 'duplicate_hold'
  | 'ready_for_posting'
  | 'awaiting_approval'
  | 'approved_waiting_gateway'
  | 'posting'
  | 'posted'
  | 'rejected'
  | 'failed'
  | 'dismissed'

export type CanonicalFilterState =
  | 'received_from_intake'
  | 'validating'
  | 'needs_correction'
  | 'duplicate_hold'
  | 'ready_for_accounting'
  | 'awaiting_approval'
  | 'posting'
  | 'posted'
  | 'rejected'
  | 'failed'
  | 'dead_letter'

export type FilterTransitionAction =
  | 'route_filter'
  | 'request_classification'
  | 'request_correction'
  | 'ready_posting'
  | 'approve'
  | 'reject'
  | 'retry'
  | 'gateway_posted'
  | 'gateway_failed'
  | 'dead_letter'

export type FilterContractInput = {
  currentState: CanonicalFilterState
  action: FilterTransitionAction
  expectedVersion: number
  actualVersion: number
  eventKey: string
  existingEventKeys?: ReadonlySet<string>
  hasConfirmedAccountingDocument?: boolean
}

export type FilterContractResult =
  | { kind: 'transition'; nextState: CanonicalFilterState; owner: 'intake' | 'filter' | 'accounting' | 'posting' }
  | { kind: 'idempotent'; nextState: CanonicalFilterState }
  | { kind: 'rejected'; reason: 'event_key_required' | 'version_conflict' | 'transition_not_allowed' | 'approval_required' | 'accounting_document_required' }

const transitions: Record<CanonicalFilterState, Partial<Record<FilterTransitionAction, CanonicalFilterState>>> = {
  received_from_intake: { route_filter: 'validating', request_classification: 'received_from_intake' },
  validating: {
    request_correction: 'needs_correction',
    ready_posting: 'ready_for_accounting',
    reject: 'rejected',
    dead_letter: 'dead_letter',
    gateway_failed: 'failed',
  },
  needs_correction: {
    retry: 'validating',
    reject: 'rejected',
    dead_letter: 'dead_letter',
  },
  duplicate_hold: {
    retry: 'validating',
    reject: 'rejected',
    dead_letter: 'dead_letter',
  },
  ready_for_accounting: { ready_posting: 'awaiting_approval', reject: 'rejected' },
  awaiting_approval: { approve: 'posting', reject: 'rejected' },
  posting: { gateway_posted: 'posted', gateway_failed: 'failed', reject: 'rejected' },
  posted: {},
  rejected: { retry: 'validating', dead_letter: 'dead_letter' },
  failed: { retry: 'validating', dead_letter: 'dead_letter' },
  dead_letter: { retry: 'received_from_intake' },
}

const owners: Record<CanonicalFilterState, 'intake' | 'filter' | 'accounting' | 'posting'> = {
  received_from_intake: 'intake',
  validating: 'filter',
  needs_correction: 'filter',
  duplicate_hold: 'filter',
  ready_for_accounting: 'accounting',
  awaiting_approval: 'posting',
  posting: 'posting',
  posted: 'posting',
  rejected: 'filter',
  failed: 'filter',
  dead_letter: 'intake',
}

export const canonicalStateFromLegacy = (state: LegacyFilterState): CanonicalFilterState => {
  if (state === 'received') return 'received_from_intake'
  if (state === 'ready_for_posting') return 'ready_for_accounting'
  if (state === 'approved_waiting_gateway') return 'posting'
  if (state === 'dismissed') return 'dead_letter'
  return state
}

export const evaluateFilterTransition = (input: FilterContractInput): FilterContractResult => {
  if (!input.eventKey.trim()) return { kind: 'rejected', reason: 'event_key_required' }
  if (input.existingEventKeys?.has(input.eventKey)) {
    return { kind: 'idempotent', nextState: input.currentState }
  }
  if (input.expectedVersion !== input.actualVersion) return { kind: 'rejected', reason: 'version_conflict' }

  if (input.action === 'approve' && input.currentState === 'awaiting_approval' && !input.hasConfirmedAccountingDocument) {
    return { kind: 'rejected', reason: 'accounting_document_required' }
  }
  if (input.action === 'ready_posting' && !input.hasConfirmedAccountingDocument) {
    return { kind: 'rejected', reason: 'accounting_document_required' }
  }
  if (input.action === 'approve' && input.currentState !== 'awaiting_approval') {
    return { kind: 'rejected', reason: 'approval_required' }
  }

  const nextState = transitions[input.currentState][input.action]
  if (!nextState) return { kind: 'rejected', reason: 'transition_not_allowed' }
  return { kind: 'transition', nextState, owner: owners[nextState] }
}
