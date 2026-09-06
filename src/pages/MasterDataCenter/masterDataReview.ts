import { isMasterReviewOpen } from '../../services/masterDataReviewWorkflow.ts'

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
  reviewed_by?: string | null
  reviewed_at?: string | null
  review_reason?: string | null
  classification_type?: string | null
  classification_confidence?: number | null
  classification_evidence?: unknown[] | null
  classification_conflicts?: unknown[] | null
  classification_version?: string | null
  classified_at?: string | null
  created_at: string
}

export type MasterSourceEvidence = {
  documentId: string | null
  intakeId: string | null
  messageId: string | null
  transactionId: string | null
  sourceRoom: string | null
  sourceChannel: string | null
  sourceSender: string | null
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
  auditCount: number
  attachmentContentType: string | null
  transferSenderName: string | null
  transferSenderBank: string | null
  transferSenderAccountLast4: string | null
  transferRecipientName: string | null
  transferRecipientBank: string | null
  transferRecipientAccountLast4: string | null
  transferAmount: number | null
  transferAt: string | null
  bankReference: string | null
  paymentPartyConfidence: number | null
  sourceResolved: boolean
  missingReasons: string[]
}

export type MasterSourceLookup = {
  transaction?: { id: string; source_message_id: string | null; sender_name: string | null; sender_bank_name: string | null; sender_account_last4: string | null; recipient_name: string | null; recipient_bank_name: string | null; recipient_account_last4: string | null; amount_total: number | null; transfer_at: string | null; bank_reference: string | null; payment_party_confidence: number | null } | null
  flow?: { id: string; intake_id: string | null; source_message_id: string | null; source_channel: string | null; source_room_name: string | null; source_sender_name: string | null; source_received_at: string | null } | null
  message?: { id: string; line_group_id: string | null; file_name: string | null; occurred_at: string | null } | null
  attachment?: { id: string; message_id: string; storage_bucket: string; storage_path: string; content_type: string | null } | null
  event?: { id: string } | null
  audit?: { id: number } | null
  auditCount?: number
}

export const emptyMasterSourceEvidence = (): MasterSourceEvidence => ({
  documentId: null, intakeId: null, messageId: null, transactionId: null, sourceRoom: null, sourceChannel: null, sourceSender: null,
  attachmentId: null, fileName: null, bucket: null, path: null, receivedAt: null, ocrRawText: null,
  extractedName: null, extractedAccount: null, aiConfidence: null, modelVersion: null, auditId: null, auditCount: 0,
  attachmentContentType: null, transferSenderName: null, transferSenderBank: null, transferSenderAccountLast4: null,
  transferRecipientName: null, transferRecipientBank: null, transferRecipientAccountLast4: null, transferAmount: null,
  transferAt: null, bankReference: null, paymentPartyConfidence: null,
  sourceResolved: false, missingReasons: [],
})

export function candidateEvidenceFallback(candidate: MasterCandidate): MasterSourceEvidence {
  const data = candidate.candidate_data ?? {}
  const string = (key: string) => typeof data[key] === 'string' && data[key] ? data[key] as string : null
  return {
    ...emptyMasterSourceEvidence(), documentId: string('document_id'), intakeId: string('intake_id'), messageId: string('message_id'),
    transactionId: candidate.source_table === 'financial_transactions' ? candidate.source_id : string('transaction_id'),
    sourceRoom: string('source_room'), sourceChannel: string('source_channel'), sourceSender: string('source_sender_name') ?? string('sender_name'), attachmentId: string('attachment_id'),
    fileName: string('file_name'), bucket: string('storage_bucket'), path: string('storage_path'), receivedAt: string('received_at') ?? candidate.created_at,
    ocrRawText: string('ocr_raw_text'), extractedName: string('ocr_name') ?? string('recipient_name') ?? candidate.display_name,
    extractedAccount: string('ocr_account_last4') ?? string('account_last4'), aiConfidence: typeof data.ai_confidence === 'number' ? data.ai_confidence : candidate.confidence,
    modelVersion: string('model_version'), auditId: string('audit_id'), auditCount: Number(data.audit_count ?? 0) || 0,
    attachmentContentType: string('attachment_content_type'), transferSenderName: string('sender_name'), transferSenderBank: string('sender_bank_name'),
    transferSenderAccountLast4: normalizeAccountLast4(data.sender_account_last4), transferRecipientName: string('recipient_name'),
    transferRecipientBank: string('recipient_bank_name') ?? string('bank_name'), transferRecipientAccountLast4: normalizeAccountLast4(data.recipient_account_last4) ?? normalizeAccountLast4(data.account_last4),
    transferAmount: typeof data.amount_total === 'number' ? data.amount_total : null, transferAt: string('transfer_at'), bankReference: string('bank_reference'),
    paymentPartyConfidence: typeof data.payment_party_confidence === 'number' ? data.payment_party_confidence : null,
    sourceResolved: Boolean(string('message_id') || string('document_id') || string('intake_id')), missingReasons: [],
  }
}

export function resolveCandidateSourceEvidence(candidate: MasterCandidate, lookup: MasterSourceLookup): MasterSourceEvidence {
  const base = candidateEvidenceFallback(candidate)
  const messageId = lookup.transaction?.source_message_id ?? (candidate.source_table === 'line_messages' ? candidate.source_id : null) ?? base.messageId
  const missingReasons = [
    !messageId && 'ไม่พบ Message ID จาก source mapping',
    messageId && !lookup.flow && 'ไม่พบ Document Flow ที่ผูกกับ Message ID',
    messageId && !lookup.attachment && 'ไม่พบไฟล์แนบที่ผูกกับ Message ID',
    !lookup.audit && 'ยังไม่มี Master Data Audit',
  ].filter((value): value is string => Boolean(value))
  return {
    ...base, transactionId: lookup.transaction?.id ?? base.transactionId, messageId: messageId ?? null,
    documentId: lookup.flow?.id ?? base.documentId, intakeId: lookup.flow?.intake_id ?? base.intakeId,
    sourceRoom: lookup.flow?.source_room_name ?? lookup.message?.line_group_id ?? base.sourceRoom,
    sourceChannel: lookup.flow?.source_channel ?? (lookup.message ? 'line' : base.sourceChannel),
    sourceSender: lookup.flow?.source_sender_name ?? base.sourceSender,
    attachmentId: lookup.attachment?.id ?? base.attachmentId, fileName: lookup.message?.file_name ?? base.fileName,
    bucket: lookup.attachment?.storage_bucket ?? base.bucket, path: lookup.attachment?.storage_path ?? base.path,
    receivedAt: lookup.flow?.source_received_at ?? lookup.message?.occurred_at ?? base.receivedAt,
    auditId: lookup.audit ? String(lookup.audit.id) : lookup.event?.id ?? base.auditId, auditCount: lookup.auditCount ?? base.auditCount,
    attachmentContentType: lookup.attachment?.content_type ?? base.attachmentContentType,
    transferSenderName: lookup.transaction?.sender_name ?? base.transferSenderName,
    transferSenderBank: lookup.transaction?.sender_bank_name ?? base.transferSenderBank,
    transferSenderAccountLast4: normalizeAccountLast4(lookup.transaction?.sender_account_last4) ?? base.transferSenderAccountLast4,
    transferRecipientName: lookup.transaction?.recipient_name ?? base.transferRecipientName,
    transferRecipientBank: lookup.transaction?.recipient_bank_name ?? base.transferRecipientBank,
    transferRecipientAccountLast4: normalizeAccountLast4(lookup.transaction?.recipient_account_last4) ?? base.transferRecipientAccountLast4,
    transferAmount: lookup.transaction?.amount_total ?? base.transferAmount, transferAt: lookup.transaction?.transfer_at ?? base.transferAt,
    bankReference: lookup.transaction?.bank_reference ?? base.bankReference,
    paymentPartyConfidence: lookup.transaction?.payment_party_confidence ?? base.paymentPartyConfidence,
    sourceResolved: Boolean(messageId && (lookup.flow || lookup.message)), missingReasons,
  }
}

export type DuplicateGroup = {
  key: string
  label: string
  reason: string
  candidateIds: string[]
}

export type MasterReviewFilter = 'all' | 'duplicate' | 'name_mismatch' | 'account_name_mismatch' | 'conflict' | 'unknown_review' | 'pending_review'

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase('th-TH').replace(/\s+/g, '')

export function normalizeAccountLast4(value: unknown) {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

export function candidateAccount(candidate: Pick<MasterCandidate, 'candidate_data'>) {
  return normalizeAccountLast4(candidate.candidate_data.account_last4)
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
  return isNameMismatch(candidate, evidence) && Boolean(candidateAccount(candidate) && candidateAccount(candidate) === normalizeAccountLast4(evidence?.extractedAccount))
}

export function reviewFilterMatches(candidate: MasterCandidate, evidence: MasterSourceEvidence | null, duplicateIds: Set<string>, filter: MasterReviewFilter) {
  if (filter === 'pending_review') return isMasterReviewOpen(candidate)
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

export function masterDataRequiresCorrection(candidate: MasterCandidate, evidence: MasterSourceEvidence | null, classificationConflicts: string[] = [], classificationType = candidate.classification_type ?? '') {
  const data = candidate.candidate_data ?? {}
  const masterName = typeof data.master_name === 'string' ? data.master_name : ''
  const masterAccount = normalizeAccountLast4(data.master_account_last4)
  const proposedAccount = candidateAccount(candidate) ?? normalizeAccountLast4(evidence?.extractedAccount)
  const nameConflict = Boolean(masterName && normalize(masterName) !== normalize(candidate.display_name)) || isNameMismatch(candidate, evidence)
  const accountConflict = Boolean(masterAccount && proposedAccount && masterAccount !== proposedAccount)
  return classificationType === 'unknown_review' || classificationConflicts.length > 0 || nameConflict || accountConflict
}
