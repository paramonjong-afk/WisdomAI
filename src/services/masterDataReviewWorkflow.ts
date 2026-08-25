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

export type MasterReviewAction = 'approve' | 'reject' | 'archive' | 'keep_existing' | 'match_master' | 'request_info' | 'lock' | 'controlled_correction'
export type MasterProjectPersistenceAction = 'link_existing_project' | 'save_project_candidate' | 'request_information' | 'return_review'

export const masterReviewOpenStatuses = ['provisional', 'pending_review', 'auto_verified', 'needs_review', 'needs_more_info', 'admin_reviewed'] as const

export function isMasterReviewOpen(candidate: Pick<MasterCandidate, 'status'>) {
  return masterReviewOpenStatuses.some((status) => status === candidate.status)
}

export function buildMasterReviewProjection<T extends Pick<MasterCandidate, 'status'>>(candidates: T[]) {
  const active = candidates.filter(isMasterReviewOpen)
  return {
    active,
    incoming: active.filter((candidate) => candidate.status === 'provisional' || candidate.status === 'pending_review'),
    followUp: active.filter((candidate) => candidate.status === 'needs_review' || candidate.status === 'needs_more_info'),
    autoVerified: active.filter((candidate) => candidate.status === 'auto_verified'),
    adminReviewed: active.filter((candidate) => candidate.status === 'admin_reviewed'),
    confirmed: candidates.filter((candidate) => ['confirmed', 'approved', 'locked'].includes(candidate.status)),
  }
}

const expectedReviewStatuses: Record<MasterReviewAction, string[]> = {
  approve: ['confirmed', 'approved'],
  reject: ['rejected'],
  archive: ['archived'],
  keep_existing: ['confirmed', 'approved'],
  match_master: ['confirmed', 'approved'],
  request_info: ['needs_review', 'needs_more_info'],
  lock: ['locked'],
  controlled_correction: ['needs_review'],
}

export function validatePersistedReviewAction(
  candidateId: string,
  action: MasterReviewAction,
  rpcCandidate: MasterCandidate | null,
  refreshedCandidate: MasterCandidate | null,
) {
  if (!rpcCandidate || rpcCandidate.id !== candidateId) return 'RPC ไม่คืน Candidate ที่บันทึกจริง จึงยังไม่ถือว่าสำเร็จ'
  if (!refreshedCandidate) return 'รีเฟรชแล้วไม่พบ Candidate เดิม จึงยังยืนยันการบันทึกไม่ได้'
  if (!expectedReviewStatuses[action].includes(refreshedCandidate.status)) return `ฐานข้อมูลยังเป็นสถานะ ${refreshedCandidate.status} ซึ่งไม่ตรงกับ Action ${action}`
  if (!refreshedCandidate.reviewed_at) return 'ฐานข้อมูลยังไม่มีเวลาที่บันทึก Action'
  return null
}

export function validatePersistedCorrection(candidateId: string, rpcCandidate: MasterCandidate | null, refreshedCandidate: MasterCandidate | null) {
  if (!rpcCandidate || rpcCandidate.id !== candidateId) return 'RPC ไม่คืน Candidate ฉบับแก้ไข จึงยังไม่ถือว่าสำเร็จ'
  if (!refreshedCandidate) return 'รีเฟรชแล้วไม่พบ Candidate ฉบับแก้ไข'
  if (refreshedCandidate.status !== 'admin_reviewed') return `ฐานข้อมูลยังเป็นสถานะ ${refreshedCandidate.status}; ต้องเป็น admin_reviewed`
  if (!text(refreshedCandidate.candidate_data.admin_corrected_at)) return 'ฐานข้อมูลยังไม่มี admin_corrected_at/Correction Version'
  return null
}

export function validatePersistedProjectGate(candidateId: string, action: MasterProjectPersistenceAction, rpcCandidate: MasterCandidate | null, refreshedCandidate: MasterCandidate | null) {
  if (!rpcCandidate || rpcCandidate.id !== candidateId) return 'RPC ไม่คืน Candidate จาก Project Gate จึงยังไม่ถือว่าสำเร็จ'
  if (!refreshedCandidate) return 'รีเฟรชแล้วไม่พบ Candidate หลังบันทึก Project Gate'
  const data = refreshedCandidate.candidate_data
  const expectedGate: Record<MasterProjectPersistenceAction, string> = {
    link_existing_project: 'linked_existing_project',
    save_project_candidate: 'awaiting_new_project',
    request_information: 'awaiting_information',
    return_review: 'review',
  }
  if (text(data.project_gate_status) !== expectedGate[action]) return `Project Gate ในฐานข้อมูลยังไม่เป็น ${expectedGate[action]}`
  if (action === 'link_existing_project' && !text(data.project_id)) return 'ยังไม่พบ Project ID ที่ผูกในฐานข้อมูล'
  if (action === 'save_project_candidate' && !text(data.project_candidate_id)) return 'ยังไม่พบ Project Candidate ID ในฐานข้อมูล'
  return null
}

export function masterReviewPersistenceNotice(candidate: Pick<MasterCandidate, 'candidate_data' | 'status' | 'reviewed_at' | 'review_reason'>) {
  if (!candidate.reviewed_at) return null
  const gate = text(candidate.candidate_data.project_gate_status)
  if (candidate.status === 'needs_review' && !gate) return 'บันทึก “ขอข้อมูลเพิ่ม” แล้ว แต่ยังไม่ได้เลือก Project, แก้ข้อมูล หรือยืนยัน Master Data รายการจึงยังอยู่คิวรอตรวจ'
  if (candidate.status === 'needs_more_info' || gate === 'awaiting_information') return 'รายการอยู่สถานะรอข้อมูลเพิ่ม และยังไม่ใช่ Master Data ที่ยืนยันแล้ว'
  if (gate === 'awaiting_new_project') return 'บันทึก Project Candidate แล้ว แต่ยังไม่ได้สร้าง Project จริงหรือยืนยัน Master Data'
  if (gate === 'linked_existing_project') return 'ผูก Project เดิมแล้ว ขั้นถัดไปคือตรวจและบันทึก Correction'
  if (candidate.status === 'admin_reviewed') return 'บันทึก Correction/Version แล้ว ขั้นถัดไปคือยืนยันข้อเสนอ'
  if (['confirmed', 'approved', 'locked'].includes(candidate.status)) return 'ยืนยัน Master Data สำเร็จและนำออกจากคิวรอตรวจแล้ว'
  return `Action ล่าสุดบันทึกเป็นสถานะ ${candidate.status}; รายการยังไม่ยืนยัน Master Data`
}

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
