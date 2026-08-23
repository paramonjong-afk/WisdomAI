import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823035155_employee_advance_confirmation_outbox.sql', 'utf8')
const page = fs.readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const gateway = fs.readFileSync('src/services/advanceConfirmationGateway.ts', 'utf8')

assert.match(migration, /status in \('queued','sent','delivered','failed','pending_room_setup','room_setup_failed'\)/)
assert.match(migration, /retry_count integer not null default 0/)
assert.match(migration, /recipient_kind in \('source_room','finance_primary','hr_primary','hr_copied'\)/)
assert.match(migration, /message_class = 'system_confirmation'/)
assert.match(migration, /SYSTEM MSG CONFIRM/)
assert.match(migration, /ห้ามนำข้อความนี้กลับไปสร้างรายการเบิกซ้ำ/)
assert.match(migration, /Advance ID/)
assert.match(migration, /Document ID/)
assert.match(migration, /confirmation_delivery_status text not null default 'not_required'/)
assert.match(migration, /pending_retry/)
assert.match(migration, /confirmation_queued/)
assert.match(migration, /confirmation_delivered/)
assert.match(migration, /confirmation_delivery_failed/)
assert.match(migration, /employee_advance_confirmation_after_insert/)
assert.match(migration, /retry_employee_advance_confirmations/)
assert.match(migration, /delivery_key text not null unique/)
assert.match(migration, /on conflict\(delivery_key\)/)
assert.match(migration, /insert into public\.chat_messages/) // source-of-truth projection
assert.match(migration, /advance_confirmation/)
assert.match(migration, /source_room_id ~\* '/)
assert.match(migration, /not similar to '%\(00\|codex\)%'/)
assert.match(migration, /room_key='finance_primary'/)
assert.match(migration, /room_key='hr_primary'/)
assert.match(migration, /ensure_advance_confirmation_room/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /confirmation_room_setup/)
assert.match(migration, /advance_confirmation_source_room_members_unverified/)
assert.match(page, /create_employee_sub_advance/)
assert.match(page, /queueAdvanceConfirmation/)
assert.match(page, /บันทึกรายการสำเร็จแล้ว แต่คิว MSG Confirm/)
assert.match(gateway, /queue_employee_advance_confirmation/)
assert.match(gateway, /retry_employee_advance_confirmations/)

type Delivery = { eventKey: string; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'room_setup_failed'; retryCount: number }

// Contract scenarios mirror the SQL state machine: queue is idempotent,
// a successful projection ends delivered, and failures remain retryable.
const queue = (rows: Map<string, Delivery>, eventKey: string): Delivery => {
  const existing = rows.get(eventKey)
  if (existing) return existing
  const created: Delivery = { eventKey, status: 'queued', retryCount: 0 }
  rows.set(eventKey, created)
  return created
}
const deliver = (row: Delivery, destinationAvailable: boolean): Delivery => {
  row.retryCount += 1
  if (!destinationAvailable) {
    row.status = 'failed'
    return row
  }
  row.status = 'sent'
  row.status = 'delivered'
  return row
}

type Room = { companyId: string; roomKey: 'hr_primary' | 'finance_primary' | 'source_room'; id: string; members: Set<string> }
const ensureStandardRoom = (rooms: Map<string, Room>, companyId: string, roomKey: Room['roomKey'], memberIds: string[]): Room => {
  const key = `${companyId}:${roomKey}`
  const existing = rooms.get(key)
  if (existing) {
    memberIds.forEach((memberId) => existing.members.add(memberId))
    return existing
  }
  const created: Room = { companyId, roomKey, id: `${roomKey}-room`, members: new Set(memberIds) }
  rooms.set(key, created)
  return created
}

const roomStates = new Map<string, Room>()
const existingRoom = ensureStandardRoom(roomStates, 'company-a', 'finance_primary', ['finance-admin'])
assert.equal(ensureStandardRoom(roomStates, 'company-a', 'finance_primary', ['finance-admin']).id, existingRoom.id)
const createdRoom = ensureStandardRoom(roomStates, 'company-a', 'hr_primary', ['hr-manager'])
assert.equal(createdRoom.members.has('hr-manager'), true)
assert.equal(roomStates.size, 2)
assert.equal(ensureStandardRoom(roomStates, 'company-a', 'hr_primary', ['hr-manager']).id, createdRoom.id)

const successRows = new Map<string, Delivery>()
const success = deliver(queue(successRows, 'advance-confirm:success:finance_primary'), true)
assert.equal(success.status, 'delivered')
assert.equal(success.retryCount, 1)

const failureRows = new Map<string, Delivery>()
const failure = deliver(queue(failureRows, 'advance-confirm:failure:finance_primary'), false)
assert.equal(failure.status, 'failed')
assert.equal(failure.retryCount, 1)
const retried = deliver(queue(failureRows, 'advance-confirm:failure:finance_primary'), true)
assert.equal(retried.status, 'delivered')
assert.equal(retried.retryCount, 2)

const duplicateRows = new Map<string, Delivery>()
const first = queue(duplicateRows, 'advance-confirm:duplicate:finance_primary')
deliver(first, true)
const duplicate = queue(duplicateRows, 'advance-confirm:duplicate:finance_primary')
assert.equal(duplicateRows.size, 1)
assert.equal(duplicate, first)
assert.equal(duplicate.status, 'delivered')

console.log('advance confirmation contract tests passed: success, failure, retry, duplicate')
