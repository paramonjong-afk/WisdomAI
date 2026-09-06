import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const functionSource = readFileSync('supabase/functions/chat-attachment-upload/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/202609060002_trusted_chat_attachment_upload.sql', 'utf8')
assert.match(functionSource, /inspectDocumentSecurity\(bytes, file\.type\)/)
assert.match(functionSource, /auth\.getUser\(token\)/)
assert.match(functionSource, /chat_room_members/)
assert.match(functionSource, /storage\.from\('chat-attachments'\)\.upload/)
assert.match(functionSource, /from\('chat_messages'\)/)
assert.match(migration, /attachment_path is null/)
assert.match(migration, /drop policy if exists "Members in room can upload chat files"/)
console.log('trusted chat attachment upload contract passed')
