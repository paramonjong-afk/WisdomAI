import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const sql = readFileSync('supabase/migrations/202609090001_posting_idempotency_recovery.sql', 'utf8')
for (const token of ['posting_operations', 'posting_operation_events', 'unique (company_id, idempotency_key)', "'retry_wait'", "'dead_letter'", 'compensation_payload', 'reserve_posting_operation']) assert.match(sql, new RegExp(token.replace(/[()]/g, '\\$&')))
assert.match(sql, /revoke all on function public\.reserve_posting_operation/)
assert.match(sql, /grant execute on function public\.reserve_posting_operation[^\n]+to service_role/)
assert.doesNotMatch(sql, /insert into public\.(accounting_draft_entries|inventory_movements)/)
console.log('posting idempotency/recovery contract passed')
