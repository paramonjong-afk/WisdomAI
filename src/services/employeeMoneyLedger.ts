export type EmployeeMoneyAccountScope = 'advance' | 'wage'
export type EmployeeMoneyEntryType =
  | 'advance_issued'
  | 'wage_paid'
  | 'advance_recovered'
  | 'cash_return'
  | 'adjustment_debit'
  | 'adjustment_credit'
  | 'reversal'
export type EmployeeMoneyEntryStatus = 'matched_pending_review' | 'approved' | 'rejected' | 'reversed'

export type EmployeeMoneyMathEntry = {
  accountScope: EmployeeMoneyAccountScope
  entryType: EmployeeMoneyEntryType
  amount: number
  status: EmployeeMoneyEntryStatus
}

export type EmployeeMoneyBalance = {
  approvedAdvanceBalance: number
  approvedWagePaid: number
  pendingAdvanceAmount: number
  pendingWagePaid: number
}

export type PayrollOffsetPreview = {
  grossAndAdditions: number
  availableBeforeAdvance: number
  advanceRecovery: number
  netCashDue: number
  closingAdvanceBalance: number
  wageCreditCarry: number
}

const thaiTitles = /^(?:นาย|นางสาว|นาง|คุณ|ช่าง|ด\.ช\.|ด\.ญ\.)\s*/i

export function normalizeEmployeePaymentName(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .replace(thaiTitles, '')
    .toLocaleLowerCase('th-TH')
    .replace(/[\s.\-_/]+/g, '')
}

function signedAdvanceAmount(entry: EmployeeMoneyMathEntry) {
  if (entry.accountScope !== 'advance') return 0
  if (entry.entryType === 'advance_issued' || entry.entryType === 'adjustment_debit') return entry.amount
  if (['advance_recovered', 'cash_return', 'adjustment_credit', 'reversal'].includes(entry.entryType)) return -entry.amount
  return 0
}

function signedWagePaidAmount(entry: EmployeeMoneyMathEntry) {
  if (entry.accountScope !== 'wage') return 0
  if (entry.entryType === 'wage_paid' || entry.entryType === 'adjustment_debit') return entry.amount
  if (entry.entryType === 'adjustment_credit' || entry.entryType === 'reversal') return -entry.amount
  return 0
}

export function calculateEmployeeMoneyBalance(entries: EmployeeMoneyMathEntry[]): EmployeeMoneyBalance {
  return entries.reduce<EmployeeMoneyBalance>((result, entry) => {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0 || ['rejected', 'reversed'].includes(entry.status)) return result
    if (entry.status === 'approved') {
      result.approvedAdvanceBalance += signedAdvanceAmount(entry)
      result.approvedWagePaid += signedWagePaidAmount(entry)
    } else if (entry.accountScope === 'advance') {
      result.pendingAdvanceAmount += Math.abs(signedAdvanceAmount(entry))
    } else if (entry.accountScope === 'wage') {
      result.pendingWagePaid += Math.abs(signedWagePaidAmount(entry))
    }
    return result
  }, { approvedAdvanceBalance: 0, approvedWagePaid: 0, pendingAdvanceAmount: 0, pendingWagePaid: 0 })
}

export function calculatePayrollOffsetPreview(input: {
  grossWage: number
  additions?: number
  otherDeductions?: number
  approvedWagePaid?: number
  approvedAdvanceBalance?: number
  requestedAdvanceRecovery?: number
  wageAdjustment?: number
}): PayrollOffsetPreview {
  const grossAndAdditions = Math.max(0, input.grossWage + (input.additions ?? 0))
  const afterOtherDeductions = grossAndAdditions - Math.max(0, input.otherDeductions ?? 0) + (input.wageAdjustment ?? 0)
  const wagePaid = Math.max(0, input.approvedWagePaid ?? 0)
  const availableBeforeAdvance = Math.max(0, afterOtherDeductions - wagePaid)
  const wageCreditCarry = Math.max(0, wagePaid - Math.max(0, afterOtherDeductions))
  const advanceBalance = Math.max(0, input.approvedAdvanceBalance ?? 0)
  const requestedRecovery = Math.max(0, input.requestedAdvanceRecovery ?? advanceBalance)
  const advanceRecovery = Math.min(advanceBalance, requestedRecovery, availableBeforeAdvance)
  return {
    grossAndAdditions,
    availableBeforeAdvance,
    advanceRecovery,
    netCashDue: availableBeforeAdvance - advanceRecovery,
    closingAdvanceBalance: advanceBalance - advanceRecovery,
    wageCreditCarry,
  }
}

