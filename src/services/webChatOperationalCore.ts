export type OperationalMessageClass = 'business' | 'system' | 'development' | 'context'

export type OperationalModule = 'HR' | 'Attendance' | 'Finance' | 'Advance' | 'Development' | 'General'

export type OperationalStatus = 'received' | 'in_progress' | 'waiting_review' | 'completed' | 'blocked' | 'duplicate' | 'failed'

export type OperationalAction = 'claim' | 'start' | 'confirm' | 'request_info' | 'return' | 'dispatch' | 'match' | 'close' | 'view_result'

export type OperationalEvidenceKind = 'image' | 'file' | 'ocr' | 'source' | 'document' | 'audit'

export type OperationalEvidence = {
  kind: OperationalEvidenceKind
  label: string
  value: string
  href?: string
}

export type OperationalAuditEvent = {
  eventKey: string
  event: string
  actorId: string
  at: string
  detail?: string
}

export type OperationalMessage = {
  id: string
  room_id: string
  sender_profile_id?: string | null
  message_type: 'text' | 'file'
  message_class?: 'user_message' | 'system_confirmation' | 'system_result' | null
  text_content?: string | null
  attachment_bucket?: string | null
  attachment_path?: string | null
  attachment_name?: string | null
  attachment_content_type?: string | null
  attachment_size?: number | null
  created_at: string
}

export type OperationalTaskCard = {
  taskId: string
  threadKey: string
  module: OperationalModule
  messageClass: OperationalMessageClass
  sourceMessageId: string
  roomId: string
  documentId: string | null
  advanceId: string | null
  attendanceId: string | null
  ownerId: string
  ownerName: string
  status: OperationalStatus
  nextAction: string
  dueAt: string
  slaMinutes: number
  evidence: OperationalEvidence[]
  exception: string | null
  unread: boolean
  failed: boolean
  duplicate: boolean
  createdAt: string
  updatedAt: string
  audit: OperationalAuditEvent[]
}

export type OperationalActor = {
  id: string
  role?: string | null
  module?: OperationalModule | null
}

export type OperationalActionResult = {
  card: OperationalTaskCard
  accepted: boolean
  duplicate: boolean
  error: string | null
}

export type OperationalDailySummary = {
  received: number
  forwarded: number
  pending: number
  closed: number
  duplicate: number
  failed: number
  unread: number
  slaBreached: number
}

const normalizeText = (value: string | null | undefined) => (value ?? '').trim()

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0').toUpperCase()
}

const firstMatch = (text: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].trim().replace(/[),.;]+$/g, '')
  }
  return null
}

const extractIds = (text: string) => ({
  advanceId: firstMatch(text, [/(ADV(?:ANCE)?[-_:#\s]*[A-Z0-9][A-Z0-9-]*)/i]),
  documentId: firstMatch(text, [/(DOC(?:UMENT)?[-_:#\s]*[A-Z0-9][A-Z0-9-]*)/i]),
  attendanceId: (() => {
    const match = text.match(/(ATT(?:ENDANCE)?|REQ)[-_:#\s]*([A-Z0-9][A-Z0-9-]*)/i)
    return match?.[0] ? match[0].replace(/\s+/g, '-') : null
  })(),
})

const isSystemContext = (message: OperationalMessage, text: string) => {
  if (message.message_class === 'system_confirmation' || message.message_class === 'system_result') return true
  return /(^|\b)(system\s+(?:result|confirmation)|ผลลัพธ์ระบบ|ยืนยันจากระบบ)(\b|:)/i.test(text)
}

const hasDevelopmentIntent = (text: string) => /\b(requirement|bug|ui|flow|database|api|test|build|deploy)\b/i.test(text)
  || /(ความต้องการ|ข้อกำหนด|บั๊ก|แก้ไขหน้า|ฐานข้อมูล|ทดสอบ|สร้างระบบ|deploy|ดีพลอย)/i.test(text)

const isDevelopment = (text: string, roomKey?: string | null) => roomKey === 'program_development_primary' || hasDevelopmentIntent(text)

const isAttendance = (text: string) => /(ลงเวลา|เข้างาน|ออกงาน|attendance|clock[-_ ]?(?:in|out)|กะงาน)/i.test(text)
const isAdvance = (text: string) => /(advance|เบิก|สำรองจ่าย|เงินสำรอง|ค่าใช้จ่าย)/i.test(text)
const isFinance = (text: string) => /(การเงิน|บัญชี|finance|ใบเสร็จ|โอนเงิน|ชำระ)/i.test(text)
const isHr = (text: string) => /(^|\b)(hr|บุคคล|พนักงาน|ช่าง|ค่าแรง|แรงงาน)(\b|$)/i.test(text)
const isDuplicate = (text: string) => /(duplicate|ซ้ำ|รายการเดิม|เคยส่งแล้ว)/i.test(text)
const isFailed = (text: string) => /(failed|failure|error|ล้มเหลว|ไม่สำเร็จ|ส่งไม่ผ่าน|retry)/i.test(text)
const isWaiting = (text: string) => /(รอข้อมูล|ขอข้อมูล|รอตรวจ|รออนุมัติ|needs?\s+more|pending)/i.test(text)

const slaMinutesFor = (module: OperationalModule) => {
  if (module === 'Attendance' || module === 'HR') return 30
  if (module === 'Advance' || module === 'Finance') return 120
  if (module === 'Development') return 24 * 60
  return 4 * 60
}

const statusLabel: Record<OperationalStatus, string> = {
  received: 'รับเข้า',
  in_progress: 'กำลังทำ',
  waiting_review: 'รอข้อมูล/รอตรวจ',
  completed: 'ปิดแล้ว',
  blocked: 'ติดข้อยกเว้น',
  duplicate: 'ซ้ำ',
  failed: 'ส่งไม่สำเร็จ',
}

const nextActionFor = (status: OperationalStatus) => {
  if (status === 'received') return 'รับงาน'
  if (status === 'in_progress') return 'ยืนยัน/ส่งต่อ'
  if (status === 'waiting_review') return 'ขอข้อมูลเพิ่ม'
  if (status === 'completed') return 'ดูผลลัพธ์'
  if (status === 'duplicate') return 'จับคู่รายการเดิม'
  if (status === 'failed') return 'Retry การส่ง'
  return 'ตรวจข้อยกเว้น'
}

const classifyModule = (text: string, roomKey?: string | null): OperationalModule => {
  if (isDevelopment(text, roomKey)) return 'Development'
  if (isAttendance(text)) return 'Attendance'
  if (isAdvance(text)) return 'Advance'
  if (isFinance(text)) return 'Finance'
  if (isHr(text)) return 'HR'
  return 'General'
}

const evidenceFromMessage = (message: OperationalMessage, text: string, ids: ReturnType<typeof extractIds>) => {
  const evidence: OperationalEvidence[] = []
  if (message.message_type === 'file' || message.attachment_name) {
    const isImage = message.attachment_content_type?.toLowerCase().startsWith('image/')
    evidence.push({
      kind: isImage ? 'image' : 'file',
      label: message.attachment_name || 'ไฟล์แนบ',
      value: message.attachment_content_type || 'ไฟล์แนบ',
      href: message.attachment_path ? `storage://${message.attachment_bucket || 'chat-attachments'}/${message.attachment_path}` : undefined,
    })
  }
  const ocr = firstMatch(text, [/(?:OCR|อ่านข้อความ|ผล OCR)\s*[:：-]\s*([^\n]+)/i])
  if (ocr) evidence.push({ kind: 'ocr', label: 'OCR', value: ocr })
  const source = firstMatch(text, [/(?:Source|แหล่งที่มา|ต้นทาง)\s*[:：-]\s*([^\n]+)/i])
  if (source) evidence.push({ kind: 'source', label: 'Source', value: source })
  if (ids.documentId) evidence.push({ kind: 'document', label: 'Document ID', value: ids.documentId })
  evidence.push({ kind: 'audit', label: 'Audit', value: `source_message:${message.id}` })
  return evidence
}

export function classifyOperationalMessage(message: OperationalMessage, roomKey?: string | null) {
  const text = normalizeText(message.text_content)
  const context = isSystemContext(message, text)
  const messageClass: OperationalMessageClass = context ? 'context' : isDevelopment(text, roomKey) ? 'development' : 'business'
  const module = context ? 'General' : classifyModule(text, roomKey)
  const ids = extractIds(text)
  const duplicate = !context && isDuplicate(text)
  const failed = !context && isFailed(text)
  const status: OperationalStatus = context ? 'completed' : failed ? 'failed' : duplicate ? 'duplicate' : isWaiting(text) ? 'waiting_review' : 'received'
  return { messageClass, module, ids, status, duplicate, failed, important: !context && (message.message_type === 'file' || Boolean(ids.advanceId || ids.documentId || ids.attendanceId) || /(เบิก|ลงเวลา|เข้างาน|ออกงาน|hr|บัญชี|finance|requirement|bug|error|failed|ขอข้อมูล|รอตรวจ)/i.test(text)) }
}

export function buildOperationalTaskCard(message: OperationalMessage, roomKey?: string | null, now = new Date()): OperationalTaskCard | null {
  const text = normalizeText(message.text_content)
  // The private development room is a command inbox, not a business work queue.
  // Non-development messages remain visible in Chat but must not create an
  // Operational Core card (or a misleading pending count) there.
  if (roomKey === 'program_development_primary' && !hasDevelopmentIntent(text)) return null
  const classified = classifyOperationalMessage(message, roomKey)
  if (!classified.important) return null
  const createdAt = new Date(message.created_at)
  const createdTime = Number.isNaN(createdAt.getTime()) ? now : createdAt
  const slaMinutes = slaMinutesFor(classified.module)
  const dueAt = new Date(createdTime.getTime() + slaMinutes * 60_000).toISOString()
  const taskId = `TASK-${hash(message.id)}`
  const initialEvent: OperationalAuditEvent = {
    eventKey: `${taskId}:received`,
    event: classified.failed ? 'task_failed' : classified.duplicate ? 'task_duplicate_detected' : 'task_received',
    actorId: message.sender_profile_id || 'system',
    at: createdTime.toISOString(),
  }
  return {
    taskId,
    threadKey: `thread:${message.id}`,
    module: classified.module,
    messageClass: classified.messageClass,
    sourceMessageId: message.id,
    roomId: message.room_id,
    documentId: classified.ids.documentId,
    advanceId: classified.ids.advanceId,
    attendanceId: classified.ids.attendanceId,
    ownerId: message.sender_profile_id || 'unassigned',
    ownerName: message.sender_profile_id || 'ยังไม่มีผู้รับผิดชอบ',
    status: classified.status,
    nextAction: nextActionFor(classified.status),
    dueAt,
    slaMinutes,
    evidence: evidenceFromMessage(message, normalizeText(message.text_content), classified.ids),
    exception: classified.failed ? 'ข้อความ/ปลายทางส่งไม่สำเร็จ ต้อง Retry' : classified.duplicate ? 'พบรายการซ้ำ ต้องจับคู่กับรายการเดิม' : null,
    unread: true,
    failed: classified.failed,
    duplicate: classified.duplicate,
    createdAt: createdTime.toISOString(),
    updatedAt: createdTime.toISOString(),
    audit: [initialEvent],
  }
}

export function buildOperationalTaskCards(messages: OperationalMessage[], roomKey?: string | null, now = new Date()) {
  return messages
    .map((message) => buildOperationalTaskCard(message, roomKey, now))
    .filter((card): card is OperationalTaskCard => Boolean(card))
}

const canAct = (card: OperationalTaskCard, actor: OperationalActor) => {
  if (actor.id === card.ownerId) return true
  if (['admin', 'company_admin', 'executive', 'manager', 'owner'].includes(actor.role ?? '')) return true
  if (actor.module && actor.module === card.module && ['HR', 'Finance', 'Advance', 'Attendance'].includes(actor.module)) return true
  return false
}

const actionStatus = (action: OperationalAction, current: OperationalStatus): OperationalStatus => {
  if (action === 'claim' || action === 'start' || action === 'dispatch') return 'in_progress'
  if (action === 'confirm' || action === 'close') return 'completed'
  if (action === 'request_info') return 'waiting_review'
  if (action === 'return') return 'blocked'
  if (action === 'match') return current === 'duplicate' ? 'in_progress' : current
  return current
}

export function applyOperationalAction(card: OperationalTaskCard, action: OperationalAction, actor: OperationalActor, now = new Date(), eventKey = `${card.taskId}:${action}`): OperationalActionResult {
  if (card.audit.some((event) => event.eventKey === eventKey)) return { card, accepted: true, duplicate: true, error: null }
  if (!canAct(card, actor)) return { card, accepted: false, duplicate: false, error: 'ไม่มีสิทธิ์ดำเนินการกับ Task นี้' }
  if (action === 'view_result') return { card: { ...card, unread: false }, accepted: true, duplicate: false, error: null }
  if (card.status === 'completed') return { card, accepted: false, duplicate: false, error: 'Task ปิดแล้ว ไม่สามารถเปลี่ยนสถานะซ้ำ' }
  const nextStatus = actionStatus(action, card.status)
  const event: OperationalAuditEvent = {
    eventKey,
    event: `task_${action}`,
    actorId: actor.id,
    at: now.toISOString(),
    detail: `${statusLabel[card.status]} → ${statusLabel[nextStatus]}`,
  }
  const nextOwner = action === 'claim' ? actor.id : card.ownerId
  const next: OperationalTaskCard = {
    ...card,
    ownerId: nextOwner,
    ownerName: nextOwner === actor.id ? actor.id : card.ownerName,
    status: nextStatus,
    nextAction: nextActionFor(nextStatus),
    unread: false,
    updatedAt: now.toISOString(),
    audit: [...card.audit, event],
  }
  return { card: next, accepted: true, duplicate: false, error: null }
}

export function markOperationalTaskRead(card: OperationalTaskCard, actor: OperationalActor, now = new Date()) {
  return applyOperationalAction(card, 'view_result', actor, now, `${card.taskId}:read`)
}

export function dailyOperationalSummary(cards: OperationalTaskCard[], now = new Date()): OperationalDailySummary {
  const pendingStatuses: OperationalStatus[] = ['received', 'waiting_review', 'blocked']
  return cards.reduce<OperationalDailySummary>((summary, card) => {
    if (card.status === 'received') summary.received += 1
    if (card.status === 'in_progress') summary.forwarded += 1
    if (pendingStatuses.includes(card.status)) summary.pending += 1
    if (card.status === 'completed') summary.closed += 1
    if (card.status === 'duplicate' || card.duplicate) summary.duplicate += 1
    if (card.status === 'failed' || card.failed) summary.failed += 1
    if (card.unread) summary.unread += 1
    if (pendingStatuses.includes(card.status) && new Date(card.dueAt).getTime() < now.getTime()) summary.slaBreached += 1
    return summary
  }, { received: 0, forwarded: 0, pending: 0, closed: 0, duplicate: 0, failed: 0, unread: 0, slaBreached: 0 })
}
