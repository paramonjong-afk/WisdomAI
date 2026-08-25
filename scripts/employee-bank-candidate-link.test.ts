import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260825233255_employee_bank_candidate_link.sql', 'utf8')
const page = readFileSync('src/pages/Employee/index.tsx', 'utf8')

assert.match(migration, /list_employee_bank_account_candidates/)
assert.match(migration, /admin_link_employee_bank_account_candidate/)
assert.match(migration, /can_manage_sensitive_employee_bank_data/)
assert.match(migration, /account\.company_id = target_company_id/)
assert.match(migration, /normalized_owner_name <> employee_normalized_name/)
assert.match(migration, /บัญชี Candidate นี้ถูกผูกกับบุคคลอื่นแล้ว/)
assert.match(migration, /'status', 'unchanged'/)
assert.match(migration, /existing_bank_candidate_linked/)
assert.match(migration, /revoke all on function public\.list_employee_bank_account_candidates\(uuid\) from public, anon/)
assert.match(migration, /revoke all on function public\.admin_link_employee_bank_account_candidate\(uuid,uuid,boolean,text\) from public, anon/)
assert.doesNotMatch(migration, /full_account_number/)

assert.match(page, /เลือกบัญชีที่ระบบพบ/)
assert.match(page, /กรอกบัญชีใหม่/)
assert.match(page, /secure_number_available \? 'มีเลขเต็มใน Secure Store พร้อมใช้จ่ายหลังผูก'/)
assert.match(page, /บัญชีของบุคคลอื่นจะเลือกไม่ได้/)

console.log('employee bank candidate link contract passed')
