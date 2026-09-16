export type AccountingApJournalRole =
  | 'base_debit'
  | 'input_tax'
  | 'accounts_payable'
  | 'withholding_tax'

export type AccountingApJournalLine = {
  lineNumber: number
  accountCode: string
  accountName: string
  role: AccountingApJournalRole
  debit: number
  credit: number
  projectId?: string
  description: string
}

export type ApprovedGatewayOperation = {
  operationId: string
  postingType: 'accounting' | 'ap'
  idempotencyKey: string
  status: 'reserved' | 'processing' | 'retry_wait'
  companyId: string
  intakeId: string
  documentId: string
  documentVersion: number
  approvalEventKey: string
  approvalSnapshotHash: string
}

export type AccountingApGatewayCommand = {
  contractVersion: '1'
  commandFingerprint: string
  accountingOperation: ApprovedGatewayOperation
  apOperation: ApprovedGatewayOperation
  documentNumber: string
  documentDate: string
  dueDate: string
  currency: 'THB'
  vendorId: string
  vendorName: string
  taxableBase: number
  inputTax: number
  withholdingTax: number
  netPayable: number
  journal: readonly AccountingApJournalLine[]
}

export type ExistingAccountingApExecution = {
  transactionKey: string
  commandFingerprint: string
  status: 'committed' | 'unknown' | 'reversed'
  journalReference?: string
  payableReference?: string
  paymentLinkReference?: string
}

export type AccountingApWritePlan = {
  transactionKey: string
  journalKey: string
  payableKey: string
  paymentLinkKey: string
  eventKeys: readonly string[]
  writes: readonly ['journal', 'payable', 'input_tax', 'payment_link', 'audit', 'operation_statuses']
  transactionRequired: true
  lookupBeforeRetry: true
  rollback: {
    beforeCommit: 'rollback_transaction'
    afterCommit: 'immutable_reversal_required'
  }
}

export type AccountingApGatewayDecision = {
  allowed: boolean
  mode: 'execute' | 'replay' | 'lookup' | 'denied'
  reason?: string
  plan?: AccountingApWritePlan
  existing?: ExistingAccountingApExecution
}

const denied = (reason: string): AccountingApGatewayDecision => ({ allowed: false, mode: 'denied', reason })
const required = (value: string) => value.trim().length > 0
const cents = (value: number) => Number.isFinite(value) ? Math.round(value * 100) : Number.NaN
const validAmount = (value: number) => Number.isFinite(value) && value >= 0 && cents(value) === value * 100
const sumCents = (lines: readonly AccountingApJournalLine[], side: 'debit' | 'credit', role?: AccountingApJournalRole) =>
  lines.filter((line) => role === undefined || line.role === role)
    .reduce((sum, line) => sum + cents(line[side]), 0)
const keyPart = (value: string) => encodeURIComponent(value.trim().toLowerCase())

const sameOperationScope = (left: ApprovedGatewayOperation, right: ApprovedGatewayOperation) =>
  left.companyId === right.companyId
  && left.intakeId === right.intakeId
  && left.documentId === right.documentId
  && left.documentVersion === right.documentVersion
  && left.approvalEventKey === right.approvalEventKey
  && left.approvalSnapshotHash === right.approvalSnapshotHash

export const buildAccountingApTransactionKey = (command: AccountingApGatewayCommand) =>
  ['accounting-ap-v1', command.accountingOperation.companyId, command.accountingOperation.intakeId,
    command.accountingOperation.documentId, String(command.accountingOperation.documentVersion)]
    .map(keyPart).join(':')

export const evaluateAccountingApGateway = (
  command: AccountingApGatewayCommand,
  existing?: ExistingAccountingApExecution,
): AccountingApGatewayDecision => {
  const accounting = command.accountingOperation
  const ap = command.apOperation
  if (command.contractVersion !== '1') return denied('accounting_ap_contract_version_unsupported')
  if (!required(command.commandFingerprint) || !required(accounting.approvalSnapshotHash)) {
    return denied('accounting_ap_approval_evidence_required')
  }
  if (accounting.postingType !== 'accounting' || ap.postingType !== 'ap') {
    return denied('accounting_ap_operation_pair_required')
  }
  if (!sameOperationScope(accounting, ap)) return denied('accounting_ap_operation_scope_mismatch')
  if (accounting.operationId === ap.operationId || accounting.idempotencyKey === ap.idempotencyKey) {
    return denied('accounting_ap_operation_identity_collision')
  }
  if (![accounting, ap].every((operation) => required(operation.operationId)
    && required(operation.idempotencyKey)
    && ['reserved', 'processing', 'retry_wait'].includes(operation.status))) {
    return denied('accounting_ap_operation_not_executable')
  }
  if (![accounting.companyId, accounting.intakeId, accounting.documentId, accounting.approvalEventKey,
    command.documentNumber, command.vendorId, command.vendorName].every(required)
    || accounting.documentVersion < 1) return denied('accounting_ap_identity_required')
  if (command.currency !== 'THB') return denied('accounting_ap_currency_unsupported')
  if (![command.taxableBase, command.inputTax, command.withholdingTax, command.netPayable].every(validAmount)) {
    return denied('accounting_ap_amount_invalid')
  }

  const documentDate = Date.parse(`${command.documentDate}T00:00:00Z`)
  const dueDate = Date.parse(`${command.dueDate}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(command.documentDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(command.dueDate)
    || !Number.isFinite(documentDate) || !Number.isFinite(dueDate) || dueDate < documentDate) {
    return denied('accounting_ap_due_date_invalid')
  }

  const base = cents(command.taxableBase)
  const inputTax = cents(command.inputTax)
  const withholdingTax = cents(command.withholdingTax)
  const payable = cents(command.netPayable)
  if (base + inputTax - withholdingTax !== payable) return denied('accounting_ap_document_amounts_do_not_reconcile')
  if (command.journal.length < 2
    || command.journal.some((line) => line.lineNumber < 1 || !Number.isInteger(line.lineNumber)
      || !required(line.accountCode) || !required(line.accountName) || !required(line.description)
      || !validAmount(line.debit) || !validAmount(line.credit)
      || (line.debit === 0) === (line.credit === 0))
    || new Set(command.journal.map((line) => line.lineNumber)).size !== command.journal.length) {
    return denied('accounting_ap_journal_line_invalid')
  }
  const debit = sumCents(command.journal, 'debit')
  const credit = sumCents(command.journal, 'credit')
  if (debit !== credit) return denied('accounting_ap_journal_unbalanced')
  if (sumCents(command.journal, 'debit', 'base_debit') !== base
    || sumCents(command.journal, 'credit', 'base_debit') !== 0
    || sumCents(command.journal, 'debit', 'input_tax') !== inputTax
    || sumCents(command.journal, 'credit', 'input_tax') !== 0
    || sumCents(command.journal, 'credit', 'accounts_payable') !== payable
    || sumCents(command.journal, 'debit', 'accounts_payable') !== 0
    || sumCents(command.journal, 'credit', 'withholding_tax') !== withholdingTax
    || sumCents(command.journal, 'debit', 'withholding_tax') !== 0) {
    return denied('accounting_ap_journal_ap_tax_do_not_reconcile')
  }

  const transactionKey = buildAccountingApTransactionKey(command)
  if (existing) {
    if (existing.transactionKey !== transactionKey || existing.commandFingerprint !== command.commandFingerprint) {
      return denied('accounting_ap_idempotency_conflict')
    }
    if (existing.status === 'unknown') return { allowed: false, mode: 'lookup', reason: 'accounting_ap_outcome_lookup_required', existing }
    return { allowed: true, mode: 'replay', existing }
  }

  const journalKey = `${transactionKey}:journal`
  const payableKey = `${transactionKey}:payable`
  const paymentLinkKey = `${transactionKey}:payment-link`
  return {
    allowed: true,
    mode: 'execute',
    plan: {
      transactionKey,
      journalKey,
      payableKey,
      paymentLinkKey,
      eventKeys: [`${transactionKey}:started`, `${transactionKey}:committed`],
      writes: ['journal', 'payable', 'input_tax', 'payment_link', 'audit', 'operation_statuses'],
      transactionRequired: true,
      lookupBeforeRetry: true,
      rollback: { beforeCommit: 'rollback_transaction', afterCommit: 'immutable_reversal_required' },
    },
  }
}
