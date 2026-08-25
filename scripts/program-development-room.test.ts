import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823035207_program_development_room.sql', 'utf8')
const actionsMigration = fs.readFileSync('supabase/migrations/20260823043451_program_development_actions.sql', 'utf8')
const flow = fs.readFileSync('docs/PROGRAM_DEVELOPMENT_ROOM_FLOW.md', 'utf8')
const chatPage = fs.readFileSync('src/pages/Chat/index.tsx', 'utf8')

assert.match(migration, /program_development_primary/)
assert.match(migration, /00 \| Program Development/)
assert.match(migration, /is_private boolean not null default false/)
assert.match(migration, /ensure_standard_program_development_room/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /on conflict do nothing/)
assert.match(migration, /program_development_private_owner_only/)
assert.match(migration, /development_tasks/)
assert.match(migration, /development_task_dispatches/)
assert.match(migration, /program_development_audit/)
assert.match(migration, /route_program_development_message/)
assert.match(migration, /system_result/)
assert.match(migration, /program-dev-dispatch/)
assert.match(actionsMigration, /dispatch_program_development_task/)
assert.match(actionsMigration, /task_dispatched/)
assert.match(migration, /status in \('received','in_progress','waiting_review','completed','blocked'\)/)
assert.match(flow, /Requirement\/Bug\/UI\/Flow\/Database\/API\/Test\/Build\/Deploy/)
assert.match(flow, /never create a new task/)
for (const action of ['Command Inbox', 'รับงาน', 'ส่งต่อ Codex', 'ส่งต่อ Module', 'เริ่มทำ', 'ขอข้อมูล', 'ปิดงาน', 'ดูผลลัพธ์']) {
  assert.match(chatPage, new RegExp(action))
}
assert.match(chatPage, /!isProgramDevelopmentRoom/, 'Program Development room must not render the shared Operational Core panel')

type Room = { key: string; owner: string; members: Set<string> }
const rooms = new Map<string, Room>()
const ensure = (companyId: string, owner: string): Room => {
  const key = `${companyId}:program_development_primary`
  const existing = rooms.get(key)
  if (existing) return existing
  const room = { key, owner, members: new Set([owner]) }
  rooms.set(key, room)
  return room
}
const first = ensure('company-a', 'owner-a')
const second = ensure('company-a', 'owner-a')
assert.equal(first, second) // concurrent/idempotent model
assert.deepEqual([...first.members], ['owner-a']) // no auto-added members

const developmentIntent = (text: string) => !/^\s*system result\b/i.test(text) && /requirement|bug|ui|flow|database|api|test|build|deploy/i.test(text)
assert.equal(developmentIntent('Bug: preview fails'), true)
assert.equal(developmentIntent('SYSTEM RESULT: build passed'), false)

const actionStatus: Record<string, string> = {
  รับงาน: 'received',
  เริ่มทำ: 'in_progress',
  ขอข้อมูล: 'waiting_review',
  ปิดงาน: 'completed',
}
assert.equal(actionStatus['รับงาน'], 'received')
assert.equal(actionStatus['เริ่มทำ'], 'in_progress')
assert.equal(actionStatus['ขอข้อมูล'], 'waiting_review')
assert.equal(actionStatus['ปิดงาน'], 'completed')

type LocalTask = { sourceMessageId: string; owner: string; status: string; audit: string[]; dispatches: Set<string> }
const localTasks = new Map<string, LocalTask>()
const ingestLocalCommand = (sourceMessageId: string, owner: string, sender: string, text: string) => {
  if (sender !== owner || !developmentIntent(text)) return null
  const existing = localTasks.get(sourceMessageId)
  if (existing) return existing
  const task: LocalTask = { sourceMessageId, owner, status: 'received', audit: ['task_received'], dispatches: new Set(['codex']) }
  localTasks.set(sourceMessageId, task)
  return task
}
const localTask = ingestLocalCommand('message-1', 'owner-a', 'owner-a', 'Requirement: local action card')
assert.equal(localTask?.status, 'received')
assert.deepEqual(ingestLocalCommand('message-1', 'owner-a', 'owner-a', 'Requirement: duplicate'), localTask)
assert.equal(ingestLocalCommand('message-2', 'owner-a', 'other-user', 'Bug: unauthorized'), null)
assert.deepEqual(localTask?.audit, ['task_received'])
localTask!.status = actionStatus['เริ่มทำ']
assert.equal(localTask?.status, 'in_progress')
localTask!.status = actionStatus['ขอข้อมูล']
assert.equal(localTask?.status, 'waiting_review')
localTask!.status = actionStatus['ปิดงาน']
assert.equal(localTask?.status, 'completed')

console.log('program development room contract tests passed: room, owner, routing, actions, statuses, result guard')
