import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260826232500_employee_bank_all_source_last4_search.sql', 'utf8')
const page = readFileSync('src/pages/Employee/index.tsx', 'utf8')

assert.match(migration, /length\(normalized_last4\) <> 4/)
assert.match(migration, /\(select auth\.uid\(\)\) is null/)
assert.match(migration, /account\.company_id\s*=\s*target_company_id/)
assert.match(migration, /account\.account_last4\s*=\s*normalized_last4/)
assert.match(migration, /name_mismatch/)
for (const source of ['master_bank_accounts', 'master_data_candidates', 'financial_transactions', 'vendor_bank_account_aliases']) assert.match(migration, new RegExp(source))
assert.match(migration, /revoke all on function public\.search_employee_bank_account_candidates\(uuid,text\) from public,\s*anon/)
assert.match(page, /search_employee_bank_account_candidates/)
assert.match(page, /เลขท้ายบัญชี 4 ตัว/)
assert.match(page, /Candidate\/OCR/)
assert.match(page, /สลิป · ผู้รับ/)
assert.match(page, /candidate\.link_status !== 'available'/)

console.log('employee bank last-4 search contract passed')
