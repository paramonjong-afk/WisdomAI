import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const sql = readFileSync('supabase/migrations/202608160013_vendor_directory_selection.sql', 'utf8')

assert.match(page, /supabase\.from\('vendors'\)\.select\('id,name,tax_id,phone'\)/)
assert.match(page, /<Autocomplete freeSolo/)
assert.match(page, /<Autocomplete freeSolo openOnFocus autoHighlight/)
assert.match(page, /เลือกผู้ขายจากทะเบียน/)
assert.match(page, /เลขผู้เสียภาษี/)
assert.match(sql, /select \* into vendor_record from public\.vendors/)
assert.match(sql, /insert into public\.vendors\(name\)/)
assert.match(sql, /vendor_id=vendor_record\.id/)
assert.match(sql, /manual_purchase_vendor_directory_selection/)

console.log('vendor directory selection checks passed')
