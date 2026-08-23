export type TransferSlipQueueFilter = 'transfer_slip' | 'pending' | 'reviewed' | 'duplicate' | 'incomplete'

export type TransferSlipQueueRow = {
  taskId: string
  itemId: string
  intakeId: string | null
  sourceMessageId: string | null
  createdAt: string
  taskStatus: string
  senderName: string | null
  recipientName: string | null
  amount: number | null
  transferAt: string | null
  reviewStatus: string | null
  route: string | null
  sourceChannel: string | null
  sourceRoomName: string | null
  sourceSenderName: string | null
  sourceReceivedAt: string | null
  dataReviewStatus: string | null
  dataReviewNote: string | null
  candidateDepartments: string[]
  expenseType: string | null
  laborAmount: number | null
  duplicateOf: string | null
}

export const isDuplicateTransferSlip = (row: TransferSlipQueueRow) => row.reviewStatus === 'duplicate' || Boolean(row.duplicateOf)

export const isIncompleteTransferSlip = (row: TransferSlipQueueRow) => !row.transferAt
  || !row.senderName?.trim()
  || !row.recipientName?.trim()
  || row.amount == null
  || row.dataReviewStatus === 'incomplete'

export const isReviewedTransferSlip = (row: TransferSlipQueueRow) => row.reviewStatus === 'confirmed' || row.taskStatus === 'completed'

export const transferSlipQueueBucket = (row: TransferSlipQueueRow): Exclude<TransferSlipQueueFilter, 'transfer_slip'> => {
  if (isDuplicateTransferSlip(row)) return 'duplicate'
  if (isIncompleteTransferSlip(row)) return 'incomplete'
  if (isReviewedTransferSlip(row)) return 'reviewed'
  return 'pending'
}

export const filterTransferSlipQueue = (rows: TransferSlipQueueRow[], filter: TransferSlipQueueFilter) => filter === 'transfer_slip'
  ? rows.filter(row => !isDuplicateTransferSlip(row))
  : rows.filter(row => transferSlipQueueBucket(row) === filter)

export const transferSlipQueueCounts = (rows: TransferSlipQueueRow[]) => ({
  transfer_slip: filterTransferSlipQueue(rows, 'transfer_slip').length,
  pending: filterTransferSlipQueue(rows, 'pending').length,
  reviewed: filterTransferSlipQueue(rows, 'reviewed').length,
  duplicate: filterTransferSlipQueue(rows, 'duplicate').length,
  incomplete: filterTransferSlipQueue(rows, 'incomplete').length,
})

export const transferSlipContinuation = (row: TransferSlipQueueRow) => {
  const expense = row.expenseType?.toLowerCase() ?? ''
  if (row.candidateDepartments.includes('payroll') || row.laborAmount != null || /payroll|wage|labor|ค่าแรง/.test(expense)) {
    return { label: 'ค่าแรง', route: 'บัญชี → ค่าแรง' }
  }
  if (row.candidateDepartments.includes('advance_finance') || /advance|reserve|เบิกล่วงหน้า|เงินสำรอง|ทดลองจ่าย/.test(expense)) {
    return { label: 'เบิกล่วงหน้า', route: 'บัญชี → เงินสำรองจ่าย' }
  }
  return { label: null, route: 'บัญชีตรวจสอบ' }
}
