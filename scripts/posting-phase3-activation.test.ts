import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const sql=readFileSync('supabase/migrations/202609160010_activate_posting_phase3.sql','utf8')
for(const key of ['POSTING-001','POSTING-002','POSTING-004','POSTING-005','POSTING-008','FILTER-004','FILTER-007','FILTER-008']) assert.ok(sql.includes(`'${key}'`))
for(const value of ['13acc9ba9ccdf973b12ff0a28bc749ef9c5de5df','13acc9b','35111437758','b2e54cde0e2c03aaf6e87261b47d73f361ca52d3','b2e54cd','passed_after_fixes']) assert.ok(sql.includes(value))
assert.match(sql,/approval_fingerprint is distinct from expected_fingerprint/); assert.match(sql,/batch_approval_receipt' <> receipt/); assert.match(sql,/item\.worker_id is not null/); assert.match(sql,/if already_final then return; end if/)
assert.match(sql,/item\.control_state <> 'waiting_qa'/)
assert.match(sql,/where work_key in \('POSTING-004','POSTING-005'\)/); assert.match(sql,/target\.phase >= 4[\s\S]*approved_waiting_dependency/); assert.match(sql,/posting_phase3_activated/)
assert.match(sql,/clean_replay[\s\S]*approved_for_execution[\s\S]*if clean_replay then return/)
console.log('Posting Phase 3 guarded activation contract passed')
