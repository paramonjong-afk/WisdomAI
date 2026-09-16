export type StockMovementKind = 'receipt' | 'issue' | 'adjustment'

export type ApprovedStockOperation = {
  operationId: string
  postingType: 'stock'
  idempotencyKey: string
  status: 'reserved' | 'processing' | 'retry_wait'
  companyId: string
  intakeId: string
  documentId: string
  documentVersion: number
  approvalEventKey: string
  approvalSnapshotHash: string
}

export type StockGatewayLine = {
  lineNumber: number
  sourceLineId: string
  inventoryItemId: string
  unit: string
  masterUnit: string
  locationId: string
  projectId: string
  quantity: number
  unitCost: number
  lineValue: number
  balanceBefore: number
  orderedQuantity?: number
  previouslyReceivedQuantity?: number
  reason?: string
}

export type StockGatewayCommand = {
  contractVersion: '1'
  commandFingerprint: string
  operation: ApprovedStockOperation
  movementKind: StockMovementKind
  documentNumber: string
  occurredAt: string
  totalValue: number
  lines: readonly StockGatewayLine[]
}

export type ExistingStockExecution = {
  transactionKey: string
  commandFingerprint: string
  status: 'committed' | 'unknown' | 'reversed'
  movementReferences?: readonly string[]
}

export type AuthoritativeStockLineState = {
  sourceLineId: string
  companyId: string
  inventoryItemId: string
  itemActive: boolean
  masterUnit: string
  locationId: string
  locationCompanyId: string
  locationActive: boolean
  projectId: string
  projectCompanyId: string
  projectActive: boolean
  balance: number
  orderedQuantity?: number
  previouslyReceivedQuantity?: number
}

export type AuthoritativeStockGatewayContext = {
  approvedOperation: ApprovedStockOperation
  commandFingerprint: string
  lines: readonly AuthoritativeStockLineState[]
}

export type StockLinePlan = {
  movementKey: string
  lineNumber: number
  quantityDelta: number
  balanceAfter: number
  receiptState?: 'partial' | 'complete'
}

export type StockWritePlan = {
  transactionKey: string
  lines: readonly StockLinePlan[]
  eventKeys: readonly string[]
  writes: readonly ['inventory_movements', 'stock_balance_projection', 'audit', 'operation_status']
  transactionRequired: true
  lookupBeforeRetry: true
  rollback: {
    beforeCommit: 'rollback_transaction'
    afterCommit: 'immutable_adjustment_or_reversal_required'
  }
}

export type StockGatewayDecision = {
  allowed: boolean
  mode: 'execute' | 'replay' | 'lookup' | 'denied'
  reason?: string
  plan?: StockWritePlan
  existing?: ExistingStockExecution
}

const denied = (reason: string): StockGatewayDecision => ({ allowed: false, mode: 'denied', reason })
const required = (value: string) => value.trim().length > 0
const keyPart = (value: string) => encodeURIComponent(value.trim().toLowerCase())
const milli = (value: number) => Number.isFinite(value) ? Math.round(value * 1_000) : Number.NaN
const cents = (value: number) => Number.isFinite(value) ? Math.round(value * 100) : Number.NaN
const validQuantity = (value: number) => Number.isFinite(value)
  && Math.abs(milli(value) - value * 1_000) < 1e-7
const validMoney = (value: number) => Number.isFinite(value) && value >= 0
  && Math.abs(cents(value) - value * 100) < 1e-7
const normalizedUnit = (value: string) => value.trim().toLocaleLowerCase('en-US')
const calculatedValueCents = (quantity: number, unitCost: number) =>
  Math.round(Math.abs(milli(quantity)) * cents(unitCost) / 1_000)

export const buildStockTransactionKey = (command: StockGatewayCommand) =>
  ['stock-v1', command.operation.companyId, command.operation.intakeId, command.operation.documentId,
    String(command.operation.documentVersion), command.operation.operationId, command.movementKind]
    .map(keyPart).join(':')

const sameApprovedOperation = (left: ApprovedStockOperation, right: ApprovedStockOperation) =>
  left.operationId === right.operationId
  && left.postingType === right.postingType
  && left.idempotencyKey === right.idempotencyKey
  && left.status === right.status
  && left.companyId === right.companyId
  && left.intakeId === right.intakeId
  && left.documentId === right.documentId
  && left.documentVersion === right.documentVersion
  && left.approvalEventKey === right.approvalEventKey
  && left.approvalSnapshotHash === right.approvalSnapshotHash

export const evaluateStockGateway = (
  command: StockGatewayCommand,
  authoritative: AuthoritativeStockGatewayContext,
  existing?: ExistingStockExecution,
): StockGatewayDecision => {
  const operation = command.operation
  if (command.contractVersion !== '1') return denied('stock_contract_version_unsupported')
  if (operation.postingType !== 'stock') return denied('stock_operation_required')
  if (!required(command.commandFingerprint) || !required(operation.approvalSnapshotHash)
    || !required(operation.approvalEventKey)) return denied('stock_approval_evidence_required')
  if (![operation.operationId, operation.idempotencyKey, operation.companyId, operation.intakeId,
    operation.documentId, command.documentNumber].every(required)
    || !Number.isSafeInteger(operation.documentVersion) || operation.documentVersion < 1) {
    return denied('stock_identity_required')
  }
  if (authoritative.commandFingerprint !== command.commandFingerprint
    || !sameApprovedOperation(operation, authoritative.approvedOperation)) {
    return denied('stock_approved_operation_mismatch')
  }
  if (!['reserved', 'processing', 'retry_wait'].includes(operation.status)) {
    return denied('stock_operation_not_executable')
  }
  if (!['receipt', 'issue', 'adjustment'].includes(command.movementKind)) return denied('stock_movement_kind_invalid')
  if (!Number.isFinite(Date.parse(command.occurredAt))) return denied('stock_occurred_at_invalid')
  if (!validMoney(command.totalValue)) return denied('stock_total_value_invalid')
  if (command.lines.length === 0) return denied('stock_lines_required')
  if (new Set(command.lines.map((line) => line.lineNumber)).size !== command.lines.length
    || new Set(command.lines.map((line) => line.sourceLineId)).size !== command.lines.length) {
    return denied('stock_line_identity_duplicate')
  }

  const plans: StockLinePlan[] = []
  let totalValueCents = 0
  for (const line of command.lines) {
    if (!Number.isInteger(line.lineNumber) || line.lineNumber < 1
      || ![line.sourceLineId, line.inventoryItemId, line.unit, line.masterUnit,
        line.locationId, line.projectId].every(required)) return denied('stock_line_identity_required')
    const master = authoritative.lines.find((candidate) => candidate.sourceLineId === line.sourceLineId)
    if (!master || master.companyId !== operation.companyId || master.locationCompanyId !== operation.companyId
      || master.projectCompanyId !== operation.companyId || !master.itemActive || !master.locationActive
      || !master.projectActive || master.inventoryItemId !== line.inventoryItemId
      || master.locationId !== line.locationId || master.projectId !== line.projectId) {
      return denied('stock_authoritative_scope_mismatch')
    }
    if (normalizedUnit(line.unit) !== normalizedUnit(line.masterUnit)
      || normalizedUnit(line.unit) !== normalizedUnit(master.masterUnit)) return denied('stock_unit_mismatch')
    if (milli(line.balanceBefore) !== milli(master.balance)) return denied('stock_balance_stale')
    if (!validQuantity(line.quantity) || line.quantity === 0 || !validQuantity(line.balanceBefore)
      || !validMoney(line.unitCost) || !validMoney(line.lineValue)) return denied('stock_line_amount_invalid')
    if (cents(line.lineValue) !== calculatedValueCents(line.quantity, line.unitCost)) {
      return denied('stock_line_value_does_not_reconcile')
    }

    let quantityDelta = line.quantity
    let receiptState: StockLinePlan['receiptState']
    if (command.movementKind === 'receipt') {
      if (line.quantity < 0 || line.orderedQuantity === undefined || line.previouslyReceivedQuantity === undefined
        || !validQuantity(line.orderedQuantity) || !validQuantity(line.previouslyReceivedQuantity)
        || line.orderedQuantity <= 0 || line.previouslyReceivedQuantity < 0) {
        return denied('stock_receipt_quantity_context_required')
      }
      if (line.orderedQuantity !== master.orderedQuantity
        || line.previouslyReceivedQuantity !== master.previouslyReceivedQuantity) {
        return denied('stock_receipt_context_stale')
      }
      const cumulative = milli(line.previouslyReceivedQuantity) + milli(line.quantity)
      if (cumulative > milli(line.orderedQuantity)) return denied('stock_receipt_exceeds_ordered_quantity')
      receiptState = cumulative < milli(line.orderedQuantity) ? 'partial' : 'complete'
    } else if (command.movementKind === 'issue') {
      if (line.quantity < 0) return denied('stock_issue_quantity_must_be_positive')
      quantityDelta = -line.quantity
      if (milli(line.balanceBefore) + milli(quantityDelta) < 0) return denied('stock_insufficient_balance')
    } else {
      if (!required(line.reason ?? '')) return denied('stock_adjustment_reason_required')
      if (milli(line.balanceBefore) + milli(quantityDelta) < 0) return denied('stock_adjustment_would_make_balance_negative')
    }

    const balanceAfter = (milli(line.balanceBefore) + milli(quantityDelta)) / 1_000
    const transactionKey = buildStockTransactionKey(command)
    plans.push({
      movementKey: `${transactionKey}:line:${line.lineNumber}`,
      lineNumber: line.lineNumber,
      quantityDelta,
      balanceAfter,
      ...(receiptState ? { receiptState } : {}),
    })
    totalValueCents += cents(line.lineValue)
  }
  if (totalValueCents !== cents(command.totalValue)) return denied('stock_total_value_does_not_reconcile')

  const transactionKey = buildStockTransactionKey(command)
  if (existing) {
    if (existing.transactionKey !== transactionKey || existing.commandFingerprint !== command.commandFingerprint) {
      return denied('stock_idempotency_conflict')
    }
    if (existing.status === 'unknown') {
      return { allowed: false, mode: 'lookup', reason: 'stock_outcome_lookup_required', existing }
    }
    if (existing.status === 'reversed') return denied('stock_execution_already_reversed')
    return { allowed: true, mode: 'replay', existing }
  }

  return {
    allowed: true,
    mode: 'execute',
    plan: {
      transactionKey,
      lines: plans,
      eventKeys: [`${transactionKey}:started`, `${transactionKey}:committed`],
      writes: ['inventory_movements', 'stock_balance_projection', 'audit', 'operation_status'],
      transactionRequired: true,
      lookupBeforeRetry: true,
      rollback: {
        beforeCommit: 'rollback_transaction',
        afterCommit: 'immutable_adjustment_or_reversal_required',
      },
    },
  }
}
