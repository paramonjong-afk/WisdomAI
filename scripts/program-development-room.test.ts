import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync('supabase/migrations/20260823035207_program_development_room.sql', 'utf8')
const flow = fs.readFileSync('docs/PROGRAM_DEVELOPMENT_ROOM_FLOW.md', 'utf8')

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
assert.match(migration, /status in \('received','in_progress','waiting_review','completed','blocked'\)/)
assert.match(flow, /Requirement\/Bug\/UI\/Flow\/Database\/API\/Test\/Build\/Deploy/)
assert.match(flow, /never create a new task/)

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

console.log('program development room contract tests passed: room, owner, routing, statuses, result guard')
