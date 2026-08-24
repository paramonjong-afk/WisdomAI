import type { MasterCandidate, MasterSourceEvidence } from '../pages/MasterDataCenter/masterDataReview'

export type MasterClassificationType = 'vendor' | 'employee_technician' | 'customer' | 'company_internal' | 'unknown_review'
export type MasterReviewBucket = 'pending' | 'duplicate' | 'name_account_mismatch' | 'conflict' | 'unknown_review'

export type MasterClassification = {
  type: MasterClassificationType
  confidence: number
  evidence: string[]
  conflicts: string[]
  reason: string
  autoVerified: boolean
  version: 'master-data-rules-v1'
}

const value = (data: Record<string, unknown>, ...keys: string[]) => keys.map((key) => data[key]).find((item) => typeof item === 'string' && item.trim()) as string | undefined
const normalized = (input: string | undefined) => (input ?? '').trim().toLocaleLowerCase('th-TH')
const mappedType = (input: string | undefined): MasterClassificationType | null => {
  if (['vendor', 'supplier'].includes(normalized(input))) return 'vendor'
  if (['employee', 'technician', 'worker'].includes(normalized(input))) return 'employee_technician'
  if (normalized(input) === 'customer') return 'customer'
  if (['company', 'internal', 'project', 'work_package'].includes(normalized(input))) return 'company_internal'
  return null
}

export function classifyMasterCandidate(candidate: MasterCandidate, source: MasterSourceEvidence, duplicate = false): MasterClassification {
  const data = candidate.candidate_data ?? {}
  const evidence: string[] = []
  const signals = new Set<MasterClassificationType>()
  const explicit = mappedType(value(data, 'matched_master_type', 'master_entity_type', 'owner_type', 'classification_type'))
  const direct = mappedType(candidate.entity_type)
  const context = normalized(value(data, 'message_context', 'context_text', 'source_text') ?? source.ocrRawText ?? '')

  if (value(data, 'matched_master_id', 'master_id')) evidence.push('master_match')
  if (candidate.entity_type === 'bank_account' && (value(data, 'account_last4') || source.extractedAccount)) evidence.push('bank_account')
  if (value(data, 'tax_id', 'vendor_tax_id', 'customer_tax_id')) evidence.push('tax_id')
  if (value(data, 'project_id', 'site_id', 'project_name', 'site_name')) evidence.push('project_site')
  if (context) evidence.push('message_context')
  if (source.sourceResolved) evidence.push('source_reference')

  if (explicit) signals.add(explicit)
  if (direct && candidate.entity_type !== 'bank_account') signals.add(direct)
  if (/ผู้ขาย|supplier|vendor|ร้านค้า/.test(context) && evidence.includes('tax_id')) signals.add('vendor')
  if (/พนักงาน|ช่าง|technician|employee|ลงเวลา|ค่าแรง/.test(context) && evidence.includes('project_site')) signals.add('employee_technician')
  if (/ลูกค้า|customer|ผู้ว่าจ้าง|ผู้ซื้อ/.test(context) && (evidence.includes('tax_id') || evidence.includes('source_reference'))) signals.add('customer')
  if (/ภายใน|internal|โครงการ|ไซต์|site|project/.test(context) && evidence.includes('project_site')) signals.add('company_internal')

  const conflicts = [
    duplicate && 'duplicate_candidate',
    signals.size > 1 && `destination_conflict:${[...signals].join('|')}`,
    ...(Array.isArray(data.conflict_flags) ? data.conflict_flags.filter((item): item is string => typeof item === 'string') : []),
  ].filter((item): item is string => Boolean(item))
  const type = signals.size === 1 ? [...signals][0] : 'unknown_review'
  const baseConfidence = typeof data.classification_confidence === 'number' ? data.classification_confidence : candidate.confidence ?? 0
  const confidence = Math.min(1, Math.max(0, value(data, 'matched_master_id', 'master_id') && explicit ? Math.max(baseConfidence, 0.98) : baseConfidence))
  const autoVerified = type !== 'unknown_review' && confidence >= 0.95 && new Set(evidence).size >= 2 && conflicts.length === 0 && source.sourceResolved
  const reason = type === 'unknown_review'
    ? signals.size > 1 ? 'พบหลักฐานขัดแย้งมากกว่าหนึ่งประเภท' : 'หลักฐานยังไม่พอสำหรับระบุประเภทโดยไม่ใช้ชื่อเพียงอย่างเดียว'
    : `จัดเป็น ${type} จาก ${[...new Set(evidence)].join(', ') || 'หลักฐานไม่ครบ'}`
  return { type, confidence, evidence: [...new Set(evidence)], conflicts, reason, autoVerified, version: 'master-data-rules-v1' }
}

export function masterReviewBucket(classification: MasterClassification, duplicate: boolean, nameMismatch: boolean): MasterReviewBucket {
  if (duplicate) return 'duplicate'
  if (classification.conflicts.length) return 'conflict'
  if (nameMismatch) return 'name_account_mismatch'
  if (classification.type === 'unknown_review') return 'unknown_review'
  return 'pending'
}

export const classificationLabel: Record<MasterClassificationType, string> = {
  vendor: 'Vendor', employee_technician: 'Employee/Technician', customer: 'Customer', company_internal: 'Company/Internal', unknown_review: 'Unknown/Needs Review',
}
