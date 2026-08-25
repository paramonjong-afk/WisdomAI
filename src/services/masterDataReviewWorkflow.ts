import type { MasterCandidate } from '../pages/MasterDataCenter/masterDataReview'
import { isProjectGateReady, projectGateStatus } from './masterDataProjectGate.ts'

export const masterReviewStepLabels = [
  'Project รอเลือก',
  'Project พร้อม',
  'แก้ข้อมูลแล้ว',
  'รอตรวจซ้ำ',
  'ยืนยันแล้ว',
] as const

export type MasterReviewStage = 'project_pending' | 'project_ready' | 'awaiting_rereview' | 'confirmed'

export type MasterProjectGateReceipt = {
  id: string
  status: string
  version: number | null
  actorId: string | null
  timestamp: string | null
  auditEventKey: string | null
}

export type MasterCorrectionReceipt = {
  version: number | null
  actorId: string | null
  timestamp: string | null
  auditEventKey: string | null
  beforeData: Record<string, unknown> | null
  afterData: Record<string, unknown> | null
}

export type MasterReviewReceipt = {
  projectCandidate: MasterProjectGateReceipt | null
  correction: MasterCorrectionReceipt | null
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function masterReviewStage(candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>): MasterReviewStage {
  if (['confirmed', 'approved', 'locked'].includes(candidate.status)) return 'confirmed'
  if (candidate.status === 'admin_reviewed' || text(candidate.candidate_data.admin_corrected_at)) return 'awaiting_rereview'
  if (isProjectGateReady(candidate)) return 'project_ready'
  return 'project_pending'
}

export function masterReviewActiveStep(candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>) {
  const stage = masterReviewStage(candidate)
  if (stage === 'confirmed') return 4
  if (stage === 'awaiting_rereview') return 3
  if (stage === 'project_ready') return 1
  return 0
}

export function masterReviewBlockers(candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>, reason: string) {
  const stage = masterReviewStage(candidate)
  const blockers: string[] = []
  if (stage === 'project_pending') blockers.push('ต้องผูก Project เดิม หรือบันทึก Project Candidate ที่ข้อมูลขั้นต่ำครบ')
  if (reason.trim().length < 3 && stage !== 'confirmed') blockers.push('เหตุผลอย่างน้อย 3 ตัวอักษร')
  if (stage === 'project_ready') blockers.push('ต้องบันทึกฉบับแก้ไขเพื่อสร้าง Version/Audit ก่อนส่งตรวจซ้ำ')
  if (stage === 'awaiting_rereview' && candidate.status !== 'admin_reviewed') blockers.push('สถานะต้องเป็น Admin แก้แล้ว/รอตรวจซ้ำ')
  return blockers
}

export function localReviewReceipt(candidate: Pick<MasterCandidate, 'candidate_data'>): MasterReviewReceipt {
  const data = candidate.candidate_data
  const projectAudit = Array.isArray(data.local_project_gate_audit) ? data.local_project_gate_audit.at(-1) : null
  const correctionAudit = Array.isArray(data.local_correction_audit) ? data.local_correction_audit.at(-1) : null
  const project = object(projectAudit)
  const correction = object(correctionAudit)
  const candidateId = text(data.project_candidate_id)
  return {
    projectCandidate: candidateId ? {
      id: candidateId,
      status: text(data.project_candidate_status) || 'awaiting_open_project',
      version: Number(data.local_project_gate_version ?? 0) || null,
      actorId: text(project?.actor_id ?? data.project_gate_updated_by) || null,
      timestamp: text(project?.at ?? data.project_gate_updated_at) || null,
      auditEventKey: text(project?.event_key) || null,
    } : null,
    correction: correction ? {
      version: Number(data.local_correction_version ?? 0) || null,
      actorId: text(correction.actor_id) || null,
      timestamp: text(correction.at ?? data.admin_corrected_at) || null,
      auditEventKey: text(correction.event_key) || null,
      beforeData: object(correction.before),
      afterData: object(correction.after),
    } : null,
  }
}

export function projectGateSummary(candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>) {
  const status = projectGateStatus(candidate)
  if (status === 'linked_existing_project') return `Project เดิม: ${text(candidate.candidate_data.project_name) || text(candidate.candidate_data.project_id)}`
  if (status === 'awaiting_new_project') return `Project Candidate: ${text(candidate.candidate_data.project_name) || text(candidate.candidate_data.project_candidate_id)}`
  return null
}
