export const reconciliationPurposeTypes = ['ทดลองจ่าย', 'เงินสำรองจ่าย', 'ค่าแรง', 'อื่นๆ'] as const
export const reconciliationStatuses = ['รอตรวจ', 'จับคู่แล้ว', 'ยอดไม่ตรง', 'ต้องขอข้อมูลเพิ่ม'] as const

export type ReconciliationPurpose = typeof reconciliationPurposeTypes[number]
export type ReconciliationStatus = typeof reconciliationStatuses[number]
export type ReconciliationAudit = {
  id: string
  actorId: string
  actorName: string
  at: string
  reason: string
  changes: Record<string, { old: unknown; new: unknown }>
  advanceId: string
  documentId: string
  flowStep: string
}
export type AdvanceRemark = {
  id: string
  text: string
  purposeType: ReconciliationPurpose
  projectName: string
  slipSender: string
  confirmedPayer: string
  expectedAmount: number | null
  transferredAmount: number | null
  difference: number | null
  status: ReconciliationStatus
  reason: string
  actorId: string
  actorName: string
  at: string
  advanceId: string
  documentId: string
  flowStep: 'กระทบยอดเงินเข้า'
}
export type AdvanceReconciliation = {
  advanceId: string
  purposeType: ReconciliationPurpose
  projectName: string
  slipSender: string
  confirmedPayer: string
  note: string
  status: ReconciliationStatus
  expectedAmount: number | null
  transferredAmount: number | null
  difference: number | null
  updatedAt: string | null
  updatedBy: string | null
  audit: ReconciliationAudit[]
  remarks: AdvanceRemark[]
}

type ReconciliationSource = { advanceId: string; advanceNumber: string; amountReceived: number; slipSender: string | null }
const storageKey = (companyId: string, advanceId: string) => `local-advance-reconciliation:${companyId}:${advanceId}`
export const isLocalReconciliationRuntime = () => typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)

export function defaultReconciliation(source: ReconciliationSource): AdvanceReconciliation {
  const isWisdomPowerFixture = source.advanceNumber === 'ADV-202608-9E7829'
  return {
    advanceId: source.advanceId,
    purposeType: isWisdomPowerFixture ? 'ทดลองจ่าย' : 'เงินสำรองจ่าย',
    projectName: isWisdomPowerFixture ? 'Wisdom Power' : '',
    slipSender: source.slipSender ?? 'ไม่พบชื่อผู้โอนตามสลิป',
    confirmedPayer: '',
    note: isWisdomPowerFixture ? 'ตัวอย่าง Local: ยอดทดลองจ่ายของ Wisdom Power ผู้โอน/ชื่อบัญชีเป็น XX' : '',
    status: 'รอตรวจ',
    expectedAmount: null,
    transferredAmount: source.amountReceived,
    difference: null,
    updatedAt: null,
    updatedBy: null,
    audit: [],
    remarks: [],
  }
}

export function loadLocalReconciliation(companyId: string, source: ReconciliationSource): AdvanceReconciliation {
  const fallback = defaultReconciliation(source)
  if (!isLocalReconciliationRuntime()) return fallback
  try {
    const stored = window.localStorage.getItem(storageKey(companyId, source.advanceId))
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as AdvanceReconciliation
    const latest = parsed.remarks?.[0]
    return { ...fallback, ...parsed, ...(latest ? { ...latest, note: latest.text } : {}), audit: parsed.audit ?? [], remarks: parsed.remarks ?? [] }
  } catch {
    return fallback
  }
}

const importantFields = new Set(['purposeType', 'projectName', 'confirmedPayer', 'status', 'expectedAmount', 'transferredAmount'])

export function saveLocalReconciliation(companyId: string, previous: AdvanceReconciliation, next: AdvanceReconciliation, actor: { id: string; name: string }, reason: string) {
  if (!isLocalReconciliationRuntime()) return { data: previous, error: 'โหมดนี้บันทึกได้เฉพาะ Local เท่านั้น' }
  const changes: Record<string, { old: unknown; new: unknown }> = {}
  for (const field of ['purposeType', 'projectName', 'confirmedPayer', 'note', 'status', 'expectedAmount', 'transferredAmount']) {
    if (previous[field as keyof AdvanceReconciliation] !== next[field as keyof AdvanceReconciliation]) changes[field] = { old: previous[field as keyof AdvanceReconciliation], new: next[field as keyof AdvanceReconciliation] }
  }
  if (!Object.keys(changes).length) return { data: previous, error: 'ยังไม่มีการเปลี่ยนแปลง' }
  if (Object.keys(changes).some((field) => importantFields.has(field)) && !reason.trim()) return { data: previous, error: 'การแก้ข้อมูลสำคัญต้องระบุเหตุผล' }
  const at = new Date().toISOString()
  const documentId = previous.advanceId
  const remark: AdvanceRemark = {
    id: crypto.randomUUID(), text: next.note, purposeType: next.purposeType, projectName: next.projectName, slipSender: previous.slipSender, confirmedPayer: next.confirmedPayer,
    expectedAmount: next.expectedAmount, transferredAmount: next.transferredAmount, difference: next.expectedAmount === null || next.transferredAmount === null ? null : next.transferredAmount - next.expectedAmount,
    status: next.status, reason: reason.trim() || 'เพิ่ม Remark กระทบยอดเงินเข้า', actorId: actor.id, actorName: actor.name, at, advanceId: previous.advanceId, documentId, flowStep: 'กระทบยอดเงินเข้า',
  }
  const saved: AdvanceReconciliation = {
    ...next,
    difference: next.expectedAmount === null || next.transferredAmount === null ? null : next.transferredAmount - next.expectedAmount,
    updatedAt: at,
    updatedBy: actor.name,
    audit: [{ id: crypto.randomUUID(), actorId: actor.id, actorName: actor.name, at, reason: reason.trim() || 'เพิ่ม Remark กระทบยอดเงินเข้า', changes, advanceId: previous.advanceId, documentId, flowStep: 'กระทบยอดเงินเข้า' }, ...previous.audit],
    remarks: [remark, ...previous.remarks],
  }
  window.localStorage.setItem(storageKey(companyId, previous.advanceId), JSON.stringify(saved))
  return { data: saved, error: null }
}
