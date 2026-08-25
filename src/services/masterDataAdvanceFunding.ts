import type { MasterCandidate, MasterSourceEvidence } from '../pages/MasterDataCenter/masterDataReview.ts'
import { normalizeAccountLast4 } from '../pages/MasterDataCenter/masterDataReview.ts'

export type MasterRecordingMode = 'project_scoped' | 'employee_advance_funding'

export type AdvanceFundingInput = {
  displayName: string
  classificationType: string
  accountLast4: string
  bankName?: string
  reason: string
}

export type AdvanceFundingRpcResult = {
  candidate?: MasterCandidate
  accounting_task?: { id?: string; status?: string; department?: string }
  lineage?: { id?: string; purpose_type?: string; route_status?: string; next_destination?: string; project_id?: string | null }
  holder_match_status?: string
  replayed?: boolean
}

export const advanceFundingRoute = {
  destination: 'Accounting Pending Queue → Advance Finance',
  owner: 'Accounting',
  nextAction: 'ตรวจสลิปและผู้ถือเงิน แล้วเปิดเงินทดลองจ่ายรอจัดสรร',
} as const

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function inferMasterRecordingMode(candidate: Pick<MasterCandidate, 'candidate_data'> | null): MasterRecordingMode {
  return candidate?.candidate_data.business_flow === 'employee_advance_funding' ? 'employee_advance_funding' : 'project_scoped'
}

export function validateAdvanceFundingInput(candidate: MasterCandidate, source: MasterSourceEvidence, input: AdvanceFundingInput) {
  const blockers = [
    candidate.entity_type !== 'bank_account' && 'ใช้ได้เฉพาะข้อมูลบัญชีจากสลิปโอนเงิน',
    candidate.source_table !== 'financial_transactions' && 'ต้องมี Financial Transaction ต้นทาง',
    !candidate.source_id && 'ไม่พบ Transaction ID ต้นทาง',
    !text(input.displayName) && 'ชื่อผู้ถือเงิน',
    input.classificationType !== 'employee_technician' && 'ประเภทต้องเป็น Employee/Technician',
    !normalizeAccountLast4(input.accountLast4) && 'เลขท้ายบัญชีอย่างน้อย 4 หลัก',
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
    display_name: input.displayName.trim(),
    normalized_name: input.displayName.replace(/\s/g, '').toLocaleLowerCase('th-TH'),
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
      account_last4: normalizeAccountLast4(input.accountLast4),
      bank_name: text(input.bankName) || candidate.candidate_data.bank_name,
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
  if (!result.accounting_task?.id || result.accounting_task.department !== 'accounting') return 'ไม่พบ Accounting Pending Task'
  if (result.lineage?.purpose_type !== 'advance_transfer' || result.lineage.next_destination !== 'advance_finance') return 'เส้นทางเงินไม่ใช่ Accounting → Advance Finance'
  if (result.lineage.project_id != null) return 'เงินเติมเข้าผู้ถือยังไม่ควรผูก Project'
  return null
}
