import assert from 'node:assert/strict'
import {
  applyOperationalAction,
  buildOperationalTaskCards,
  classifyOperationalMessage,
  dailyOperationalSummary,
  markOperationalTaskRead,
  type OperationalMessage,
} from '../src/services/webChatOperationalCore.ts'

const message = (overrides: Partial<OperationalMessage>): OperationalMessage => ({
  id: 'message-hr-1', room_id: 'room-hr', sender_profile_id: 'owner-1', message_type: 'text',
  message_class: 'user_message', text_content: 'ช่างสมชาย ลงเวลาเข้า ATT-2026-001 Source: Web Chat OCR: 08:00',
  attachment_bucket: null, attachment_path: null, attachment_name: null, attachment_content_type: null,
  attachment_size: null, created_at: '2026-08-23T08:00:00.000Z', ...overrides,
})

const now = new Date('2026-08-23T08:15:00.000Z')
const hr = message({})
const finance = message({
  id: 'message-finance-1', room_id: 'room-finance', sender_profile_id: 'finance-1',
  text_content: 'เบิกเงินสำรองจ่าย ADV-2026-009 DOC-2026-009 รอตรวจ',
  message_type: 'file', attachment_name: 'ใบเสร็จ.pdf', attachment_content_type: 'application/pdf',
})
const duplicate = message({ id: 'message-duplicate', text_content: 'รายการเดิมซ้ำ ADV-2026-009' })
const failed = message({ id: 'message-failed', text_content: 'ส่งไม่สำเร็จ retry ไปห้อง HR ATT-2026-404' })
const systemResult = message({ id: 'message-system', message_class: 'system_result', text_content: 'SYSTEM RESULT: ลงเวลาสำเร็จ ATT-2026-001' })
const legacySystemAttendance = message({ id: 'message-legacy-system', sender_profile_id: null, message_class: 'user_message', text_content: 'ลงเวลาเข้า ช่างสมชาย สถานะ: normal รหัสรายการ: ATT-LEGACY-001' })
const development = message({ id: 'message-dev', room_id: 'room-dev', text_content: 'Bug: แนบรูปไม่ได้' })

assert.deepEqual(classifyOperationalMessage(systemResult), {
  messageClass: 'context', module: 'General', ids: { advanceId: null, documentId: null, attendanceId: 'ATT-2026-001' },
  status: 'completed', duplicate: false, failed: false, important: false,
})
assert.equal(classifyOperationalMessage(legacySystemAttendance).messageClass, 'context')
assert.equal(classifyOperationalMessage(legacySystemAttendance).important, false)

const cards = buildOperationalTaskCards([hr, finance, duplicate, failed, systemResult, legacySystemAttendance, development], 'hr_primary', now)
assert.equal(cards.length, 5)
assert.equal(cards[0]?.threadKey, 'thread:message-hr-1')
assert.equal(cards[0]?.attendanceId, 'ATT-2026-001')
assert.equal(cards[0]?.evidence.some((item) => item.kind === 'ocr'), true)
assert.equal(cards[1]?.advanceId, 'ADV-2026-009')
assert.equal(cards[1]?.documentId, 'DOC-2026-009')
assert.equal(cards[1]?.evidence[0]?.kind, 'file')
assert.equal(cards[4]?.module, 'Development')
assert.notEqual(cards[0]?.threadKey, cards[1]?.threadKey)

const developmentRoomCards = buildOperationalTaskCards([hr, finance, duplicate, failed, systemResult, legacySystemAttendance, development], 'program_development_primary', now)
assert.equal(developmentRoomCards.length, 1, 'development room must not create business Operational Core cards')
assert.equal(developmentRoomCards[0]?.sourceMessageId, development.id)

const ownerCard = cards[0]!
const unauthorized = applyOperationalAction(ownerCard, 'close', { id: 'other-user', role: 'employee' }, now)
assert.equal(unauthorized.accepted, false)
assert.match(unauthorized.error ?? '', /ไม่มีสิทธิ์/)

const started = applyOperationalAction(ownerCard, 'start', { id: 'owner-1', role: 'employee' }, now)
assert.equal(started.card.status, 'in_progress')
const requested = applyOperationalAction(started.card, 'request_info', { id: 'owner-1', role: 'employee' }, now, 'event-request-info')
assert.equal(requested.card.status, 'waiting_review')
const returned = applyOperationalAction(requested.card, 'return', { id: 'owner-1', role: 'employee' }, now, 'event-return')
assert.equal(returned.card.status, 'blocked')
const dispatched = applyOperationalAction(returned.card, 'dispatch', { id: 'owner-1', role: 'employee' }, now, 'event-dispatch')
assert.equal(dispatched.card.status, 'in_progress')
const matched = applyOperationalAction(cards[2]!, 'match', { id: 'owner-1', role: 'manager' }, now, 'event-match')
assert.equal(matched.card.status, 'in_progress')
const confirmed = applyOperationalAction(dispatched.card, 'confirm', { id: 'owner-1', role: 'employee' }, now, 'event-confirm')
assert.equal(confirmed.card.status, 'completed')
const duplicateEvent = applyOperationalAction(confirmed.card, 'close', { id: 'owner-1', role: 'employee' }, now, 'event-confirm')
assert.equal(duplicateEvent.duplicate, true)
assert.equal(duplicateEvent.card.audit.length, confirmed.card.audit.length)
const read = markOperationalTaskRead(cards[1]!, { id: 'finance-1', role: 'finance' }, now)
assert.equal(read.card.unread, false)

const summary = dailyOperationalSummary(cards, new Date('2026-08-23T12:00:00.000Z'))
assert.deepEqual(summary, { received: 2, forwarded: 0, pending: 3, closed: 0, duplicate: 1, failed: 1, unread: 5, slaBreached: 2 })
console.log('web chat operational core local tests passed: classification, cards, threads, evidence, permissions, actions, idempotency, read state, summary')
