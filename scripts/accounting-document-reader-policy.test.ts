import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql = fs.readFileSync('supabase/migrations/20260907090000_accounting_document_reader_policy.sql', 'utf8')
assert.match(sql, /drop policy if exists "Authenticated users read accounting documents"/)
assert.equal((sql.match(/company_id = public\.current_company_id\(\)/g) ?? []).length, 3)
assert.equal((sql.match(/company_role='accounting_hr'/g) ?? []).length, 3)
assert.equal((sql.match(/array\['accounting','finance','audit','auditor'\]/g) ?? []).length, 3)
assert.doesNotMatch(sql, /create policy "Authenticated users read accounting documents"/)
console.log('accounting reader policy contract passed')
