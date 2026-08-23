export type MasterCandidate = {
  id: string
  entity_type: string
  display_name: string
  normalized_name: string
  candidate_data: Record<string, unknown>
  confidence: number | null
  status: string
  source_table: string | null
  source_id: string | null
  duplicate_of: string | null
  created_at: string
}

export type MasterSourceEvidence = {
  documentId: string | null
  intakeId: string | null
  messageId: string | null
  sourceRoom: string | null
  sourceChannel: string | null
  attachmentId: string | null
  fileName: string | null
  bucket: string | null
  path: string | null
  receivedAt: string | null
  ocrRawText: string | null
  extractedName: string | null
  extractedAccount: string | null
  aiConfidence: number | null
  modelVersion: string | null
  auditId: string | null
}

export type DuplicateGroup = {
  key: string
  label: string
  reason: string
  candidateIds: string[]
}

export type MasterReviewFilter = 'all' | 'duplicate' | 'name_mismatch' | 'account_name_mismatch' | 'pending_review'

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('th-TH').replace(/\s+/g, '')

export function candidateAccount(candidate: Pick<MasterCandidate, 'candidate_data'>) {
  return typeof candidate.candidate_data.account_last4 === 'string' ? candidate.candidate_data.account_last4 : null
}

export function duplicateGroupKey(candidate: Pick<MasterCandidate, 'normalized_name' | 'candidate_data'>) {
  return `${candidate.normalized_name || normalize(candidate.candidate_data.recipient_name as string | null)}|${candidateAccount(candidate) ?? ''}`
}

export function groupDuplicateCandidates(candidates: MasterCandidate[]): DuplicateGroup[] {
  const groups = new Map<string, MasterCandidate[]>()
  candidates.forEach((candidate) => {
    const key = duplicateGroupKey(candidate)
    if (!key.endsWith('|')) groups.set(key, [...(groups.get(key) ?? []), candidate])
  })
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      label: `${items[0].display_name} · •••• ${candidateAccount(items[0]) ?? '-'}`,
      reason: 'ชื่อหลัง normalize และเลขท้ายบัญชีตรงกัน แต่ระบบเก็บแต่ละ source เป็นคนละรายการ',
      candidateIds: items.map((item) => item.id),
    }))
}

export function isNameMismatch(candidate: MasterCandidate, evidence: MasterSourceEvidence | null) {
  if (!evidence?.extractedName) return false
  return normalize(evidence.extractedName) !== normalize(candidate.display_name)
}

export function isAccountNameMismatch(candidate: MasterCandidate, evidence: MasterSourceEvidence | null) {
  return isNameMismatch(candidate, evidence) && Boolean(candidateAccount(candidate) && evidence?.extractedAccount && candidateAccount(candidate) === evidence.extractedAccount)
}

export function reviewFilterMatches(candidate: MasterCandidate, evidence: MasterSourceEvidence | null, duplicateIds: Set<string>, filter: MasterReviewFilter) {
  if (filter === 'pending_review') return ['provisional', 'needs_review', 'pending_review', 'needs_more_info'].includes(candidate.status)
  if (filter === 'duplicate') return duplicateIds.has(candidate.id)
  if (filter === 'name_mismatch') return isNameMismatch(candidate, evidence)
  if (filter === 'account_name_mismatch') return isAccountNameMismatch(candidate, evidence)
  return true
}

export function mismatchStage(candidate: MasterCandidate, evidence: MasterSourceEvidence | null) {
  if (!evidence?.extractedName) return 'ยังไม่มี OCR/source เพียงพอ'
  if (normalize(evidence.extractedName) !== normalize(candidate.display_name)) return 'OCR / mapping'
  return 'ไม่พบชื่อผิดจาก source ที่โหลดได้'
}
