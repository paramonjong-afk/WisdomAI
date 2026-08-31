export type HolderSettlement = { expense_type: string; amount: number; approval_status: string; evidence_flow_item_id: string | null }
export type HolderAdvanceCase = {
  id: string; advance_number: string; holder_profile_id: string | null; holder_person_id: string | null
  financial_transaction_id: string | null; amount_received: number; status: string; updated_at: string
  financial_transactions: { transfer_at: string | null } | null
  employee_advance_settlement_items: HolderSettlement[] | null
}
export type HolderBalance = { received: number; paidOrOffset: number; returned: number; balance: number; pendingAmount: number; pendingCount: number; excludedAmount: number; excludedCount: number; updatedAt: string | null; cases: HolderAdvanceCase[]; postedIncomingTransactionIds: string[]; postedOutgoingItemIds: string[] }
const amount = (value: number) => Number(value) || 0
export function calculateHolderBalance(cases: HolderAdvanceCase[]): HolderBalance {
  let received = 0; let paidOrOffset = 0; let returned = 0; let pendingAmount = 0; let pendingCount = 0; let excludedAmount = 0; let excludedCount = 0
  const activeCases = cases.filter((advanceCase) => {
    if (!['cancelled', 'rejected'].includes(advanceCase.status)) return true
    excludedAmount += amount(advanceCase.amount_received); excludedCount += 1
    return false
  })
  for (const advanceCase of activeCases) {
    received += amount(advanceCase.amount_received)
    for (const item of advanceCase.employee_advance_settlement_items ?? []) {
      if (item.approval_status === 'approved') {
        if (item.expense_type === 'cash_return') returned += amount(item.amount)
        else paidOrOffset += amount(item.amount)
      } else if (['draft', 'submitted', 'returned'].includes(item.approval_status)) {
        pendingAmount += amount(item.amount); pendingCount += 1
      }
    }
  }
  return {
    received, paidOrOffset, returned, balance: received - paidOrOffset - returned, pendingAmount, pendingCount,
    excludedAmount, excludedCount,
    updatedAt: cases.map((item) => item.updated_at).filter(Boolean).sort().at(-1) ?? null,
    cases: [...activeCases].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    postedIncomingTransactionIds: activeCases.map((item) => item.financial_transaction_id).filter((id): id is string => Boolean(id)),
    postedOutgoingItemIds: activeCases.flatMap((item) => item.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').map((item) => item.evidence_flow_item_id).filter((id): id is string => Boolean(id)),
  }
}
