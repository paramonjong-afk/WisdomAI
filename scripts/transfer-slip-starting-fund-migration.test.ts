import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260831054814_support_masked_bank_digits_and_starting_fund.sql', 'utf8')
assert.match(sql, /\^\[0-9\]\{3,4\}\$/)
assert.match(sql, /classify_transfer_slip_advance_draft_v1/)
assert.match(sql, /allocation\.purpose_type='advance_transfer'/)
assert.match(sql, /expense_type='advance'/)
assert.match(sql, /document_flow_events/)
assert.match(sql, /workflow_permission_denied/)
assert.match(sql, /revoke all on function public\.classify_transfer_slip_advance_draft_v1\(uuid,text\) from public,anon/)
assert.match(sql, /grant execute on function public\.classify_transfer_slip_advance_draft_v1\(uuid,text\) to authenticated/)
assert.doesNotMatch(sql, /drop table|truncate|delete from/i)
console.log('transfer slip starting-fund migration contract: PASS')
