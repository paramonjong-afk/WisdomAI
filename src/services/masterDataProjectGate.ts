import type { MasterCandidate, MasterSourceEvidence } from '../pages/MasterDataCenter/masterDataReview'

export type MasterProjectGateStatus =
  | 'received'
  | 'awaiting_project_classification'
  | 'linked_existing_project'
  | 'awaiting_new_project'
  | 'awaiting_information'
  | 'review'
  | 'confirmed'

export type MasterProjectOption = {
  id: string
  name: string
  code: string | null
  status: string
  project_name?: string | null
  developer_name?: string | null
  province?: string | null
  location_detail?: string | null
  property_type?: string | null
}

export type MasterProjectCandidateDraft = {
  project_name: string
  customer_owner_name: string
  site_location: string
  responsible_name: string
  work_type: string
  approximate_start_date: string
}

export type MasterProjectCandidateRecord = MasterProjectCandidateDraft & {
  id: string
  source_candidate_id: string
  linked_project_id: string | null
  status: 'awaiting_open_project' | 'confirmed_project_candidate' | 'rejected' | 'archived'
  version: number
  updated_at: string
}

export type ProjectMatch = { project: MasterProjectOption; score: number; evidence: string[] }

export const emptyProjectDraft = (): MasterProjectCandidateDraft => ({
  project_name: '', customer_owner_name: '', site_location: '', responsible_name: '', work_type: '', approximate_start_date: '',
})

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const normalize = (value: unknown) => text(value).toLocaleLowerCase('th-TH').replace(/[^a-z0-9\u0E00-\u0E7F]/g, '')
const includesEither = (left: unknown, right: unknown) => {
  const a = normalize(left); const b = normalize(right)
  return Boolean(a && b && (a.includes(b) || b.includes(a)))
}

export function projectGateStatus(candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>): MasterProjectGateStatus {
  if (['confirmed', 'approved', 'locked'].includes(candidate.status)) return 'confirmed'
  const stored = text(candidate.candidate_data.project_gate_status) as MasterProjectGateStatus
  return ['received', 'awaiting_project_classification', 'linked_existing_project', 'awaiting_new_project', 'awaiting_information', 'review', 'confirmed'].includes(stored) ? stored : 'received'
}

export const isProjectGateReady = (candidate: Pick<MasterCandidate, 'candidate_data' | 'status'>) =>
  ['linked_existing_project', 'awaiting_new_project', 'confirmed'].includes(projectGateStatus(candidate))

export function projectDraftFromCandidate(candidate: MasterCandidate, source: MasterSourceEvidence): MasterProjectCandidateDraft {
  const data = candidate.candidate_data ?? {}
  return {
    project_name: text(data.project_name) || text(data.detected_project_name) || (text(source.sourceRoom).startsWith('โครงการ') ? text(source.sourceRoom) : ''),
    customer_owner_name: text(data.customer_owner_name) || text(data.customer_name) || text(data.owner_name),
    site_location: text(data.site_location) || text(data.site_name) || text(data.location),
    responsible_name: text(data.responsible_name) || text(data.assignee_name) || text(data.sender_name),
    work_type: text(data.work_type) || text(data.property_type),
    approximate_start_date: text(data.approximate_start_date) || text(data.project_start_date),
  }
}

export function validateProjectDraft(draft: MasterProjectCandidateDraft, source: MasterSourceEvidence) {
  const missing = [
    !text(draft.project_name) && 'ชื่อโครงการ',
    !text(draft.customer_owner_name) && 'ลูกค้าหรือเจ้าของงาน',
    !text(draft.site_location) && 'ไซต์/สถานที่',
    !text(draft.responsible_name) && 'ผู้รับผิดชอบ',
    !text(draft.work_type) && 'ประเภทงาน',
    !text(draft.approximate_start_date) && 'วันที่เริ่มโดยประมาณ',
    !(source.documentId || source.intakeId || source.messageId) && 'Source/Document ID',
  ].filter((value): value is string => Boolean(value))
  return { valid: missing.length === 0, missing }
}

export function findProjectMatches(candidate: MasterCandidate, source: MasterSourceEvidence, projects: MasterProjectOption[]): ProjectMatch[] {
  const data = candidate.candidate_data ?? {}
  const inputs = [
    ['ชื่อโครงการ', data.project_name ?? data.detected_project_name],
    ['รหัสอ้างอิง', data.project_code ?? data.reference_code],
    ['ลูกค้า/เจ้าของงาน', data.customer_owner_name ?? data.customer_name ?? data.owner_name],
    ['ไซต์/สถานที่', data.site_location ?? data.site_name ?? data.location],
    ['ห้องต้นทาง', source.sourceRoom],
  ] as const
  return projects.map((project) => {
    const fields = [project.name, project.code, project.project_name, project.developer_name, project.province, project.location_detail]
    const evidence = inputs.filter(([, input]) => fields.some((field) => includesEither(input, field))).map(([label]) => label)
    return { project, score: evidence.length, evidence }
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name, 'th'))
}

export function applyLocalProjectGate(
  candidate: MasterCandidate,
  action: 'link_existing_project' | 'save_project_candidate' | 'request_information' | 'return_review',
  payload: Record<string, unknown>,
  now = new Date().toISOString(),
) {
  const nextData = { ...candidate.candidate_data }
  if (action === 'link_existing_project') {
    Object.assign(nextData, { project_gate_status: 'linked_existing_project', project_id: payload.project_id, project_name: payload.project_name, project_match_evidence: payload.match_evidence, project_gate_updated_at: now })
  } else if (action === 'save_project_candidate') {
    Object.assign(nextData, { ...payload, project_gate_status: 'awaiting_new_project', project_candidate_id: payload.project_candidate_id ?? `local-project-candidate-${candidate.id}`, project_gate_updated_at: now })
  } else if (action === 'request_information') {
    Object.assign(nextData, { project_gate_status: 'awaiting_information', project_gate_updated_at: now })
  } else {
    Object.assign(nextData, { project_gate_status: 'review', project_gate_updated_at: now })
  }
  Object.assign(nextData, {
    local_project_gate_version: Number(nextData.local_project_gate_version ?? 0) + 1,
    local_project_gate_audit: [...(Array.isArray(nextData.local_project_gate_audit) ? nextData.local_project_gate_audit : []), { action, at: now }],
  })
  return { ...candidate, candidate_data: nextData, status: action === 'request_information' ? 'needs_more_info' : candidate.status }
}

export const projectGateStatusLabel: Record<MasterProjectGateStatus, string> = {
  received: 'รับเข้า', awaiting_project_classification: 'รอจำแนกโครงการ', linked_existing_project: 'ผูก Project เดิมแล้ว', awaiting_new_project: 'รอเปิดโครงการใหม่', awaiting_information: 'รอข้อมูลเพิ่ม', review: 'รอตรวจ', confirmed: 'ยืนยันแล้ว',
}
