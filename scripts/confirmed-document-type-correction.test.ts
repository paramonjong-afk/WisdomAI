import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150026_confirmed_document_type_correction.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /correct_confirmed_accounting_document_type/)
assert.match(migration, /doc\.status<>'confirmed'/)
assert.match(migration, /accounting_document_dimension_audit/)
assert.match(migration, /Does not modify allocations, amounts, posting status, or journal entries/)
assert.match(page, /selected\.status === 'confirmed'/)
assert.match(page, /correct_confirmed_accounting_document_type/)
assert.doesNotMatch(page, /disabled=\{!canManage \|\| saving \|\| selected\.status === 'confirmed'\}/)
assert.match(page, /ยอดเงินและรายการบัญชีจะไม่เปลี่ยน/)

console.log('confirmed document type correction tests passed')
