import type { MasterCandidate, MasterSourceEvidence } from '../pages/MasterDataCenter/masterDataReview.ts'
import { normalizeAccountLast4 } from '../pages/MasterDataCenter/masterDataReview.ts'

export type MasterRecordingMode = 'project_scoped' | 'employee_advance_funding'

export type TransferPartyDraft = {
  senderName: string
  senderAccountLast4: string
  senderBankName: string
  recipientName: string
  recipientAccountLast4: string
  recipientBankName: string
}

export type AdvanceFundingInput = {
  senderName: string
  senderAccountLast4: string
  senderBankName?: string
  recipientName: string
  recipientAccountLast4: string
  recipientBankName?: string
  classificationType: string
  reason: string
}

export type AdvanceFundingRpcResult = {
  candidate?: MasterCandidate
  party_review?: {
    id?: string
    review_status?: string
    sender_review_status?: string
    recipient_review_status?: string
    sender_master_bank_account_id?: string
    recipient_master_bank_account_id?: string
    version?: number
  }
  sender_bank_account?: { id?: string; owner_type?: string; account_last4?: string }
  recipient_bank_account?: { id?: string; owner_type?: string; account_last4?: string }
  accounting_task?: { id?: string; status?: string; department?: string }
  lineage?: { id?: string; purpose_type?: string; route_status?: string; next_destination?: string; project_id?: string | null }
  holder_match_status?: string
  replayed?: boolean
}

export const advanceFundingRoute = {
  destination: 'Accounting Pending Queue → Advance Finance',
  owner: 'Accounting',
  nextAction: 'ตรวจคู่ผู้โอน–ผู้รับและสลิป แล้วเปิดเงินทดลองจ่ายรอจัดสรร',
} as const

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function inferMasterRecordingMode(candidate: Pick<MasterCandidate, 'candidate_data'> | null): MasterRecordingMode {
  return candidate?.candidate_data.business_flow === 'employee_advance_funding'
    || candidate?.candidate_data.transaction_purpose === 'advance_transfer'
    || candidate?.candidate_data.expense_type === 'advance'
    ? 'employee_advance_funding'
    : 'project_scoped'
}

export function transferPartyDraft(candidate: MasterCandidate, source: MasterSourceEvidence): TransferPartyDraft {
  const persisted = isAdvancePartyReviewConfirmed(candidate)
  return {
    senderName: persisted ? text(candidate.candidate_data.sender_name) || text(source.transferSenderName) : text(source.transferSenderName) || text(candidate.candidate_data.sender_name),
    senderAccountLast4: normalizeAccountLast4(persisted ? candidate.candidate_data.sender_account_last4 ?? source.transferSenderAccountLast4 : source.transferSenderAccountLast4 ?? candidate.candidate_data.sender_account_last4) ?? '',
    senderBankName: persisted ? text(candidate.candidate_data.sender_bank_name) || text(source.transferSenderBank) : text(source.transferSenderBank) || text(candidate.candidate_data.sender_bank_name),
    recipientName: persisted ? text(candidate.candidate_data.recipient_name) || text(source.transferRecipientName) || text(candidate.display_name) : text(source.transferRecipientName) || text(candidate.candidate_data.recipient_name) || text(candidate.display_name),
    recipientAccountLast4: normalizeAccountLast4(persisted ? candidate.candidate_data.recipient_account_last4 ?? source.transferRecipientAccountLast4 ?? candidate.candidate_data.account_last4 : source.transferRecipientAccountLast4 ?? candidate.candidate_data.recipient_account_last4 ?? candidate.candidate_data.account_last4) ?? '',
    recipientBankName: persisted ? text(candidate.candidate_data.recipient_bank_name) || text(source.transferRecipientBank) || text(candidate.candidate_data.bank_name) : text(source.transferRecipientBank) || text(candidate.candidate_data.recipient_bank_name) || text(candidate.candidate_data.bank_name),
  }
}

export function isAdvancePartyReviewConfirmed(candidate: Pick<MasterCandidate, 'candidate_data'> | null) {
  return candidate?.candidate_data.transfer_party_review_status === 'confirmed'
    && candidate.candidate_data.sender_review_status === 'confirmed'
    && candidate.candidate_data.recipient_review_status === 'confirmed'
}

export function validateAdvanceFundingInput(candidate: MasterCandidate, source: MasterSourceEvidence, input: AdvanceFundingInput) {
  const blockers = [
    candidate.entity_type !== 'bank_account' && 'ใช้ได้เฉพาะข้อมูลบัญชีจากสลิปโอนเงิน',
    candidate.source_table !== 'financial_transactions' && 'ต้องมี Financial Transaction ต้นทาง',
    !candidate.source_id && 'ไม่พบ Transaction ID ต้นทาง',
    !text(input.senderName) && 'ชื่อผู้โอน/แหล่งเงิน',
    !normalizeAccountLast4(input.senderAccountLast4) && 'เลขท้ายบัญชีผู้โอนอย่างน้อย 4 หลัก',
    !text(input.recipientName) && 'ชื่อผู้รับ/ผู้ถือเงิน',
    input.classificationType !== 'employee_technician' && 'ประเภทต้องเป็น Employee/Technician',
    !normalizeAccountLast4(input.recipientAccountLast4) && 'เลขท้ายบัญชีผู้รับอย่างน้อย 4 หลัก',
    !(source.documentId || source.intakeId || source.messageId) && 'Document/Intake/Message ID',
    !(source.transferAmount != null && source.transferAmount > 0) && 'ยอดโอนที่มากกว่า 0',
    input.reason.trim().length < 3 && 'เหตุผลอย่างน้อย 3 ตัวอักษร',
  ].filter((value): value is string => Boolean(value))
  return { valid: blockers.length === 0, blockers }
}

export function applyLocalAdvanceFunding(
  candidate: MasterCandidate,
  source: MasterSourceEvidence,
  input: AdvanceFundingInput,
  now = new Date().toISOString(),
  eventKey = `local-advance-funding-${candidate.id}-${Date.parse(now)}`,
) {
  const validation = validateAdvanceFundingInput(candidate, source, input)
  if (!validation.valid) throw new Error(`master_advance_input_invalid:${validation.blockers.join(',')}`)
  const accountingTaskId = `local-accounting-task-${candidate.id}`
  const lineageId = `local-money-lineage-${candidate.id}`
  const before = structuredClone(candidate)
  const result: MasterCandidate = {
    ...candidate,
    display_name: input.recipientName.trim(),
    normalized_name: input.recipientName.replace(/\s/g, '').toLocaleLowerCase('th-TH'),
    classification_type: 'employee_technician',
    classification_confidence: Math.max(candidate.classification_confidence ?? candidate.confidence ?? 0, 0.95),
    classification_evidence: ['admin_advance_funding', 'bank_account', 'source_reference'],
    classification_conflicts: [],
    classification_version: 'master-data-advance-funding-v1',
    classified_at: now,
    status: 'confirmed',
    review_reason: input.reason.trim(),
    reviewed_by: 'local-admin',
    reviewed_at: now,
    candidate_data: {
      ...candidate.candidate_data,
      classification_type: 'employee_technician',
      business_flow: 'employee_advance_funding',
      transaction_purpose: 'advance_transfer',
      account_last4: normalizeAccountLast4(input.recipientAccountLast4),
      bank_name: text(input.recipientBankName) || candidate.candidate_data.bank_name,
      sender_name: input.senderName.trim(),
      sender_account_last4: normalizeAccountLast4(input.senderAccountLast4),
      sender_bank_name: text(input.senderBankName) || null,
      sender_classification: 'company_internal',
      sender_review_status: 'confirmed',
      sender_master_bank_account_id: `local-sender-bank-${candidate.id}`,
      recipient_name: input.recipientName.trim(),
      recipient_account_last4: normalizeAccountLast4(input.recipientAccountLast4),
      recipient_bank_name: text(input.recipientBankName) || null,
      recipient_classification: 'employee_technician',
      recipient_review_status: 'confirmed',
      recipient_master_bank_account_id: `local-recipient-bank-${candidate.id}`,
      transfer_party_review_id: `local-party-review-${candidate.id}`,
      transfer_party_review_status: 'confirmed',
      transfer_party_review_version: 1,
      project_gate_resolution: 'not_required_advance_funding',
      project_gate_status: 'confirmed',
      project_allocation_status: 'awaiting_allocation',
      suggested_destination: advanceFundingRoute.destination,
      suggested_owner: advanceFundingRoute.owner,
      suggested_next_action: advanceFundingRoute.nextAction,
      advance_holder_match_status: 'awaiting_employee_match',
      accounting_task_id: accountingTaskId,
      money_lineage_id: lineageId,
      advance_funding_confirmed_at: now,
      advance_funding_confirmed_by: 'local-admin',
      local_advance_funding_audit: [
        ...(Array.isArray(candidate.candidate_data.local_advance_funding_audit) ? candidate.candidate_data.local_advance_funding_audit : []),
        { event_key: eventKey, action: 'candidate_confirm_employee_advance_funding', at: now, actor_id: 'local-admin', before, after_status: 'confirmed' },
      ],
    },
  }
  return {
    candidate: result,
    party_review: {
      id: `local-party-review-${candidate.id}`,
      review_status: 'confirmed',
      sender_review_status: 'confirmed',
      recipient_review_status: 'confirmed',
      sender_master_bank_account_id: `local-sender-bank-${candidate.id}`,
      recipient_master_bank_account_id: `local-recipient-bank-${candidate.id}`,
      version: 1,
    },
    sender_bank_account: { id: `local-sender-bank-${candidate.id}`, owner_type: 'other', account_last4: normalizeAccountLast4(input.senderAccountLast4) ?? undefined },
    recipient_bank_account: { id: `local-recipient-bank-${candidate.id}`, owner_type: 'employee', account_last4: normalizeAccountLast4(input.recipientAccountLast4) ?? undefined },
    accounting_task: { id: accountingTaskId, status: 'recheck_required', department: 'accounting' },
    lineage: { id: lineageId, purpose_type: 'advance_transfer', route_status: 'accounting_review', next_destination: 'advance_finance', project_id: null },
    holder_match_status: 'awaiting_employee_match',
    replayed: false,
  } satisfies AdvanceFundingRpcResult
}

export function validatePersistedAdvanceFunding(candidateId: string, result: AdvanceFundingRpcResult | null, persisted: MasterCandidate | null) {
  if (!result?.candidate || result.candidate.id !== candidateId) return 'RPC ไม่คืน Candidate เงินทดลองจ่ายรายการเดิม'
  if (!persisted || persisted.id !== candidateId) return 'โหลด Candidate หลังบันทึกไม่สำเร็จ'
  if (persisted.status !== 'confirmed') return `สถานะหลังบันทึกเป็น ${persisted.status} แทน confirmed`
  if (persisted.classification_type !== 'employee_technician') return 'ประเภทยังไม่เป็น Employee/Technician'
  if (persisted.candidate_data.business_flow !== 'employee_advance_funding') return 'ไม่พบ business_flow เงินทดลองจ่ายหลังบันทึก'
  if (persisted.candidate_data.project_allocation_status !== 'awaiting_allocation') return 'สถานะ Project allocation ไม่ถูกต้อง'
  if (!isAdvancePartyReviewConfirmed(persisted)) return 'คู่ผู้โอน–ผู้รับยังไม่ได้ยืนยันครบทั้งสองฝั่ง'
  if (result.party_review?.review_status !== 'confirmed' || result.party_review.sender_review_status !== 'confirmed' || result.party_review.recipient_review_status !== 'confirmed') return 'ไม่พบผลยืนยัน Transfer Party Pair'
  if (!result.sender_bank_account?.id || !result.recipient_bank_account?.id) return 'ไม่พบ Master Account ของผู้โอนหรือผู้รับ'
  if (!result.accounting_task?.id || result.accounting_task.department !== 'accounting') return 'ไม่พบ Accounting Pending Task'
  if (result.lineage?.purpose_type !== 'advance_transfer' || result.lineage.next_destination !== 'advance_finance') return 'เส้นทางเงินไม่ใช่ Accounting → Advance Finance'
  if (result.lineage.project_id != null) return 'เงินเติมเข้าผู้ถือยังไม่ควรผูก Project'
  return null
}
