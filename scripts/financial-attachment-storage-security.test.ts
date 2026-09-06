import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync(
  'supabase/migrations/20260905113756_restrict_financial_attachment_room_access.sql',
  'utf8',
)

for (const obsoletePolicy of [
  'Authenticated users can view stored LINE files',
  'Company members view LINE files',
  'Company members view chat files',
  'Members in company can view chat files',
  'Members and managers can view chat files',
]) {
  assert.match(migration, new RegExp(`drop policy if exists "${obsoletePolicy}"`))
}

assert.match(migration, /bucket_id = 'chat-attachments'/)
assert.match(migration, /from public\.chat_rooms room/)
assert.match(migration, /room\.id = \(storage\.foldername\(objects\.name\)\)\[2\]::uuid/)
assert.match(migration, /room\.company_id = \(storage\.foldername\(objects\.name\)\)\[1\]::uuid/)
assert.match(migration, /public\.is_company_manager\(room\.company_id\)/)
assert.match(migration, /public\.is_company_member\(room\.company_id\)[\s\S]*public\.is_chat_room_member\(room\.id\)/)
assert.match(migration, /else false/)
assert.doesNotMatch(migration, /public\s+bucket/i)
assert.doesNotMatch(migration, /is_company_member\([^)]*foldername[^)]*\)\s*\n?\s*or/)

type AccessCase = {
  sameCompany: boolean
  roomMember: boolean
  companyManager: boolean
  validPath: boolean
}

const mayRead = ({ sameCompany, roomMember, companyManager, validPath }: AccessCase) => (
  validPath && sameCompany && (companyManager || roomMember)
)

assert.equal(mayRead({ sameCompany: true, roomMember: true, companyManager: false, validPath: true }), true)
assert.equal(mayRead({ sameCompany: true, roomMember: false, companyManager: true, validPath: true }), true)
assert.equal(mayRead({ sameCompany: true, roomMember: false, companyManager: false, validPath: true }), false)
assert.equal(mayRead({ sameCompany: false, roomMember: true, companyManager: false, validPath: true }), false)
assert.equal(mayRead({ sameCompany: false, roomMember: false, companyManager: true, validPath: true }), false)
assert.equal(mayRead({ sameCompany: true, roomMember: true, companyManager: false, validPath: false }), false)

console.log('financial attachment Storage policy checks passed')
