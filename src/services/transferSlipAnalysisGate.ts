import type { TransferSlipQueueRow } from './accountingTransferSlipQueue.ts'
import type { MoneyLineageDraft, MoneyPurpose } from './transferSlipMoneyLineage.ts'
import { moneyPurposeRoute, validateMoneyLineage } from './transferSlipMoneyLineage.ts'

export type SlipAnalysisGate = {
  purpose: MoneyPurpose
  confidence: number
  reasons: string[]
  blockers: string[]
  destination: string
  state: 'auto_routed' | 'ready_to_confirm' | 'needs_confirmation'
}

export function isSuspiciousTransferDate(value: string | null | undefined, now = new Date()) {
  if (!value) return false
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return true
  const year = parsed.getUTCFullYear()
  return year < 2020 || year > now.getUTCFullYear() + 1
}

const contains = (value: string | null | undefined, pattern: RegExp) => pattern.test(value?.toLowerCase() ?? '')

export function inferSlipMoneyPurpose(row: Pick<TransferSlipQueueRow, 'candidateDepartments' | 'expenseType' | 'laborAmount' | 'notes'>): Pick<SlipAnalysisGate, 'purpose' | 'confidence' | 'reasons'> {
  const departments = row.candidateDepartments ?? []
  const evidence = `${row.expenseType ?? ''} ${row.notes ?? ''}`
  if (departments.includes('payroll') || row.laborAmount != null || contains(evidence, /payroll|wage|labor|ค่าแรง/)) return { purpose: 'payroll', confidence: departments.includes('payroll') ? .95 : .85, reasons: ['พบสัญญาณค่าแรง/Payroll'] }
  if (contains(evidence, /refund|return|คืนเงิน|คืนสำรอง/)) return { purpose: 'refund_return', confidence: .8, reasons: ['พบสัญญาณคืนเงิน'] }
  if (departments.includes('advance_finance') || contains(evidence, /advance|reserve|เบิกล่วงหน้า|เงินสำรอง|ทดลองจ่าย/)) return { purpose: 'advance_transfer', confidence: departments.includes('advance_finance') ? .95 : .85, reasons: ['พบสัญญาณเงินเบิกล่วงหน้า/เงินสำรอง'] }
  if (contains(evidence, /vendor|supplier|ผู้ขาย|ร้านค้า/)) return { purpose: 'vendor_payment', confidence: .8, reasons: ['พบสัญญาณจ่ายผู้ขาย'] }
  if (contains(evidence, /material|วัสดุ|อุปกรณ์/)) return { purpose: 'materials', confidence: .8, reasons: ['พบสัญญาณวัสดุ/อุปกรณ์'] }
  if (contains(evidence, /project|site|โครงการ|หน้างาน/)) return { purpose: 'project_expense', confidence: .75, reasons: ['พบสัญญาณค่าใช้จ่ายโครงการ'] }
  return { purpose: 'unknown', confidence: row.candidateDepartments.length ? .6 : 0, reasons: ['หลักฐานยังไม่พอจำแนกประเภทเงิน'] }
}

export function buildSlipAnalysisGate(row: TransferSlipQueueRow, draft: MoneyLineageDraft | null): SlipAnalysisGate {
  const inferred = inferSlipMoneyPurpose(row)
  const purpose = draft?.allocations.length === 1 && draft.allocations[0].purposeType !== 'unknown' ? draft.allocations[0].purposeType : inferred.purpose
  const blockers: string[] = []
  if (row.duplicateOf || row.reviewStatus === 'duplicate') blockers.push('พบสลิปซ้ำ ต้องตรวจรายการต้นฉบับ')
  if (!row.senderName?.trim()) blockers.push('ยืนยันผู้โอน')
  if (!row.senderAccountLast4) blockers.push('ยืนยันบัญชีผู้โอน')
  if (!row.recipientName?.trim()) blockers.push('ยืนยันผู้รับ')
  if (!row.recipientAccountLast4) blockers.push('ยืนยันบัญชีผู้รับ')
  if (row.amount == null || row.amount <= 0) blockers.push('ยืนยันยอดเงิน')
  if (!row.transferAt) blockers.push('ยืนยันวันเวลาโอน')
  else if (isSuspiciousTransferDate(row.transferAt)) blockers.push('วันที่ผิดปกติ ต้องตรวจจากสลิป')
  if (purpose === 'unknown') blockers.push('ยืนยันประเภทเงิน')
  if (draft) {
    const validation = validateMoneyLineage(draft, row.amount)
    blockers.push(...validation.missing.map(value => `กรอก ${value}`), ...validation.errors)
  }
  const uniqueBlockers = [...new Set(blockers)]
  const destination = moneyPurposeRoute(purpose).route
  const autoRouted = row.truthStatus === 'confirmed' && row.isPostable && uniqueBlockers.length === 0
  return {
    purpose,
    confidence: draft?.allocations[0]?.purposeType !== 'unknown' ? 1 : inferred.confidence,
    reasons: draft?.allocations[0]?.purposeType !== 'unknown' ? ['Admin เลือกประเภทเงินแล้ว'] : inferred.reasons,
    blockers: uniqueBlockers,
    destination,
    state: autoRouted ? 'auto_routed' : uniqueBlockers.length === 0 ? 'ready_to_confirm' : 'needs_confirmation',
  }
}

export const slipPurposeNeedsProject = (purpose: MoneyPurpose) => ['materials', 'project_expense', 'subcontractor', 'travel'].includes(purpose)
export const slipPurposeNeedsFundHolder = (purpose: MoneyPurpose) => ['advance_transfer', 'onward_transfer', 'cash_withdrawal', 'refund_return'].includes(purpose)
