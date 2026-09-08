export type PostingLine = {
  debit: number
  credit: number
}

export type PostingValidationInput = {
  companyId: string
  actorRole: string
  eventKey: string
  expectedVersion: number
  actualVersion: number
  truthStatus: 'needs_review' | 'needs_information' | 'confirmed' | 'duplicate'
  isPostable: boolean
  documentStatus: string
  periodStatus: 'open' | 'review' | 'closed' | 'paying' | 'paid' | 'cancelled'
  documentTotal: number
  lineTotal: number
  taxTotal?: number | null
  lines: readonly PostingLine[]
  purchaseOrderRemaining?: number | null
  receiptRemaining?: number | null
  requestedAmount?: number | null
  availableBalance?: number | null
}

export type PostingValidationResult = {
  allowed: boolean
  blockers: string[]
  balance: { debit: number; credit: number; difference: number }
}

const EPSILON = 0.01
const managerRoles = new Set(['admin', 'company_admin', 'manager', 'owner', 'accounting', 'finance'])
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const closeEnough = (left: number, right: number) => Math.abs(left - right) <= EPSILON

export function validatePosting(input: PostingValidationInput): PostingValidationResult {
  const blockers: string[] = []
  const debit = round(input.lines.reduce((total, line) => total + Math.max(0, line.debit), 0))
  const credit = round(input.lines.reduce((total, line) => total + Math.max(0, line.credit), 0))
  const difference = round(debit - credit)

  if (!input.companyId.trim()) blockers.push('company_required')
  if (!managerRoles.has(input.actorRole)) blockers.push('posting_role_not_allowed')
  if (!input.eventKey.trim()) blockers.push('event_key_required')
  if (input.expectedVersion !== input.actualVersion) blockers.push('stale_version')
  if (input.truthStatus !== 'confirmed' || !input.isPostable) blockers.push('canonical_truth_not_postable')
  if (input.documentStatus !== 'confirmed') blockers.push('document_not_confirmed')
  if (['closed', 'paying', 'paid', 'cancelled'].includes(input.periodStatus)) blockers.push('period_locked')
  if (!closeEnough(input.documentTotal, input.lineTotal + (input.taxTotal ?? 0))) blockers.push('document_line_tax_mismatch')
  if (!closeEnough(debit, credit)) blockers.push('debit_credit_imbalance')
  if (input.purchaseOrderRemaining != null && input.requestedAmount != null && input.requestedAmount > input.purchaseOrderRemaining + EPSILON) blockers.push('purchase_order_overage')
  if (input.receiptRemaining != null && input.requestedAmount != null && input.requestedAmount > input.receiptRemaining + EPSILON) blockers.push('receipt_overage')
  if (input.availableBalance != null && input.requestedAmount != null && input.requestedAmount > input.availableBalance + EPSILON) blockers.push('balance_insufficient')

  return { allowed: blockers.length === 0, blockers, balance: { debit, credit, difference } }
}
