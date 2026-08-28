import type { MasterCandidate, MasterSourceEvidence } from '../pages/MasterDataCenter/masterDataReview.ts'
import { normalizeAccountLast4 } from '../pages/MasterDataCenter/masterDataReview.ts'
import type { MasterClassification, MasterClassificationType } from './masterDataClassification.ts'

export type AutoInputStatus = 'ready' | 'review' | 'conflict' | 'missing' | 'persisted'

export type AutoInputField<T extends string = string> = {
  value: T
  source: string
  confidence: number | null
  status: AutoInputStatus
}

export type MasterAutoCorrection = {
  display_name: AutoInputField
  classification_type: AutoInputField<MasterClassificationType>
  classification_suggestion: AutoInputField<MasterClassificationType> | null
  account_last4: AutoInputField
  bank_name: AutoInputField
  tax_id: AutoInputField
}

export type MasterAutoRoute = {
  destination: string
  owner: string
  nextAction: string
  requiresReview: boolean
}

export type DetectedProjectStart = {
  date: string
  source: string
  confidence: number | null
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const dateOnly = (value: unknown) => {
  const raw = text(value)
  if (!raw) return ''
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (direct) return direct
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}
const first = (data: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = text(data[key])
    if (value) return { value, source: `candidate_data.${key}` }
  }
  return { value: '', source: '' }
}
const status = (value: string, confidence: number | null, conflict = false): AutoInputStatus => {
  if (!value) return 'missing'
  if (conflict) return 'conflict'
  if (confidence != null && confidence >= 0.95) return 'ready'
  return 'review'
}
const classificationTypes = new Set<MasterClassificationType>(['vendor', 'employee_technician', 'customer', 'company_internal', 'unknown_review'])
const persistedAdminStatuses = new Set(['admin_reviewed', 'confirmed', 'locked'])
const hasPersistedAdminCorrection = (candidate: MasterCandidate) => (
  persistedAdminStatuses.has(candidate.status) && Boolean(text(candidate.candidate_data?.admin_corrected_at))
)
const savedAdminClassification = (candidate: MasterCandidate): MasterClassificationType | null => {
  if (!persistedAdminStatuses.has(candidate.status)) return null
  const value = text(candidate.classification_type) || text(candidate.candidate_data?.classification_type)
  if (!classificationTypes.has(value as MasterClassificationType) || value === 'unknown_review') return null
  return value as MasterClassificationType
}

export function detectProjectStartDate(candidate: MasterCandidate, source: MasterSourceEvidence): DetectedProjectStart {
  const data = candidate.candidate_data ?? {}
  const candidates = [
    ['วันที่เริ่มที่ยืนยันไว้', data.confirmed_start_date],
    ['วันที่เริ่มที่ระบบเคยตรวจพบ', data.detected_start_date],
    ['วันที่เริ่มโครงการจากข้อมูล', data.project_start_date],
    ['วันที่เริ่มโดยประมาณจากข้อมูล', data.approximate_start_date],
    ['กิจกรรมแรกของโครงการ', data.project_first_activity_at],
    ['ข้อความ/เอกสารต้นทางรายการแรก', data.first_seen_at],
    ['เวลารับเข้าต้นทาง', source.receivedAt],
    ['เวลาสร้าง Candidate', candidate.created_at],
  ].map(([label, value]) => ({ label: String(label), date: dateOnly(value) })).filter((item) => item.date)
  if (!candidates.length) return { date: '', source: '', confidence: null }
  const earliest = candidates.toSorted((left, right) => left.date.localeCompare(right.date))[0]
  const isExplicit = /ยืนยัน|เริ่มโครงการจากข้อมูล/.test(earliest.label)
  return { date: earliest.date, source: earliest.label, confidence: isExplicit ? 1 : source.aiConfidence ?? candidate.confidence }
}

export function buildMasterAutoCorrection(candidate: MasterCandidate, source: MasterSourceEvidence, classification: MasterClassification): MasterAutoCorrection {
  const data = candidate.candidate_data ?? {}
  const persistedCorrection = hasPersistedAdminCorrection(candidate)
  const sourceName = text(source.extractedName) || text(data.ocr_name) || text(data.recipient_name)
  const displayName = persistedCorrection ? text(candidate.display_name) : sourceName || text(candidate.display_name)
  const nameConflict = Boolean(sourceName && candidate.display_name && sourceName.replace(/\s/g, '') !== candidate.display_name.replace(/\s/g, ''))
  const accountFromSource = normalizeAccountLast4(source.extractedAccount)
  const accountFromCandidate = normalizeAccountLast4(data.account_last4)
  const account = persistedCorrection ? accountFromCandidate || '' : accountFromSource || accountFromCandidate || ''
  const accountConflict = Boolean(accountFromSource && accountFromCandidate && accountFromSource !== accountFromCandidate)
  const bank = first(data, ['bank_name', 'recipient_bank_name', 'ocr_bank_name'])
  const tax = first(data, ['tax_id', 'vendor_tax_id', 'customer_tax_id', 'ocr_tax_id'])
  const confidence = source.aiConfidence ?? candidate.confidence
  const persistedClassification = savedAdminClassification(candidate)
  const classificationField: AutoInputField<MasterClassificationType> = persistedClassification
    ? { value: persistedClassification, source: 'Admin Correction ที่บันทึกแล้ว', confidence: null, status: 'persisted' }
    : { value: classification.type, source: classification.reason, confidence: classification.confidence, status: status(classification.type === 'unknown_review' ? '' : classification.type, classification.confidence, classification.conflicts.length > 0) }
  const classificationSuggestion = persistedClassification && persistedClassification !== classification.type
    ? { value: classification.type, source: classification.reason, confidence: classification.confidence, status: status(classification.type === 'unknown_review' ? '' : classification.type, classification.confidence, classification.conflicts.length > 0) }
    : null
  return {
    display_name: { value: displayName, source: persistedCorrection ? 'Admin Correction ที่บันทึกแล้ว' : sourceName ? 'OCR/หลักฐานต้นทาง' : 'Candidate เดิม', confidence: persistedCorrection ? null : confidence, status: persistedCorrection ? 'persisted' : status(displayName, confidence, nameConflict) },
    classification_type: classificationField,
    classification_suggestion: classificationSuggestion,
    account_last4: { value: account, source: persistedCorrection ? 'Admin Correction ที่บันทึกแล้ว' : accountFromSource ? 'OCR/บัญชีจากหลักฐาน' : accountFromCandidate ? 'Candidate เดิม' : '', confidence: persistedCorrection ? null : confidence, status: persistedCorrection ? 'persisted' : status(account, confidence, accountConflict) },
    bank_name: { value: bank.value, source: persistedCorrection ? 'Admin Correction ที่บันทึกแล้ว' : bank.source, confidence: persistedCorrection ? null : confidence, status: persistedCorrection ? 'persisted' : status(bank.value, confidence) },
    tax_id: { value: tax.value, source: persistedCorrection ? 'Admin Correction ที่บันทึกแล้ว' : tax.source, confidence: persistedCorrection ? null : confidence, status: persistedCorrection ? 'persisted' : status(tax.value, confidence) },
  }
}

export function masterAutoRoute(type: MasterClassificationType, confidence: number, conflicts: string[]): MasterAutoRoute {
  if (conflicts.length || type === 'unknown_review' || confidence < 0.75) return { destination: 'Master Data Review', owner: 'Company Admin', nextAction: 'ตรวจหลักฐานและเลือกประเภท', requiresReview: true }
  const routes: Record<Exclude<MasterClassificationType, 'unknown_review'>, Omit<MasterAutoRoute, 'requiresReview'>> = {
    vendor: { destination: 'Accounting / Procurement', owner: 'บัญชีหรือจัดซื้อ', nextAction: 'ตรวจผู้ขายและบัญชีรับเงิน' },
    employee_technician: { destination: 'HR / Payroll', owner: 'HR', nextAction: 'ตรวจบุคคลและผูกข้อมูลพนักงาน/ช่าง' },
    customer: { destination: 'Project / Sales', owner: 'ผู้ดูแลโครงการหรือลูกค้า', nextAction: 'ตรวจลูกค้าและความสัมพันธ์โครงการ' },
    company_internal: { destination: 'Project / Site', owner: 'ผู้รับผิดชอบโครงการ', nextAction: 'ตรวจข้อมูลภายในและผูกไซต์/งานย่อย' },
  }
  return { ...routes[type], requiresReview: confidence < 0.95 }
}

export function autoInputAuditPayload(correction: MasterAutoCorrection, route: MasterAutoRoute) {
  return {
    generated_at: new Date().toISOString(),
    rule_version: 'master-data-auto-input-v2',
    fields: Object.fromEntries(Object.entries(correction).filter((entry): entry is [string, AutoInputField] => Boolean(entry[1])).map(([key, field]) => [key, { source: field.source, confidence: field.confidence, status: field.status }])),
    suggested_destination: route.destination,
    suggested_owner: route.owner,
    suggested_next_action: route.nextAction,
  }
}
