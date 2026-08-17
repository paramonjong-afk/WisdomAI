import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('supabase/functions/telegram-admin/index.ts', 'utf8')

assert.match(source, /my_chat_member/)
assert.match(source, /allowed_updates:\['message','callback_query','my_chat_member'\]/)
assert.match(source, /chat_activated/)
assert.match(source, /chat_deactivated/)
assert.match(source, /telegram_admin_chats'\)\.upsert/)
assert.match(source, /onConflict:'company_id,telegram_chat_id'/)

console.log('telegram stale-chat recovery contract passed')
