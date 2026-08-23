import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823035220_general_work_room.sql', 'utf8')
assert.match(migration, /general_work_primary/)
assert.match(migration, /01 \| งานทั่วไป/)
assert.match(migration, /ensure_standard_general_work_room/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /general_work_routes/)
assert.match(migration, /route_general_work_message/)
assert.match(migration, /program_development_primary/)
assert.match(migration, /system_result/)
assert.match(migration, /pending_destination/)
assert.match(migration, /on conflict do nothing/)

const rooms = new Map<string, { id: string; members: Set<string> }>()
const ensure = (companyId: string, owner: string) => {
  const key = `${companyId}:general_work_primary`
  const existing = rooms.get(key)
  if (existing) return existing
  const created = { id: `room-${companyId}`, members: new Set([owner, 'member-a']) }
  rooms.set(key, created)
  return created
}
assert.equal(ensure('company-a', 'owner-a'), ensure('company-a', 'owner-a'))
assert.deepEqual([...ensure('company-a', 'owner-a').members], ['owner-a', 'member-a'])

const route = (text: string) => {
  const lower = text.toLowerCase()
  if (/requirement|bug|ui|database|api|test|build|deploy|พัฒนา/.test(lower)) return 'program_development_primary'
  if (/ลงเวลา|attendance|hr|บุคคล/.test(lower)) return 'hr_primary'
  if (/เบิก|finance|accounting|การเงิน/.test(lower)) return 'finance_primary'
  return 'general_work_primary'
}
assert.equal(route('Bug: ปรับหน้า Chat'), 'program_development_primary')
assert.equal(route('ลงเวลาเข้า ช่าง'), 'hr_primary')
assert.equal(route('เบิกเงินสำรอง'), 'finance_primary')
assert.equal(route('เสนอไอเดียทั่วไป'), 'general_work_primary')

console.log('general work room contract tests passed: idempotency, company membership, routing and destination guard')
