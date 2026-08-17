import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150024_accounting_document_type_learning.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

for (const purpose of ['material','subcontractor','service','labor','equipment','welfare','overhead','other']) {
  assert.match(migration, new RegExp(`'${purpose}'`))
  assert.match(page, new RegExp(`${purpose}:`))
}
assert.match(migration, /accounting_document_classification_rules/)
assert.match(migration, /status in \('pending','needs_correction'\)/)
assert.match(migration, /confirmed_document_type_is_locked/)
assert.match(migration, /apply_accounting_document_classification_rule_trigger/)
assert.match(page, /บันทึกประเภท/)
assert.match(page, /จำประเภทนี้สำหรับผู้ขาย/)
assert.match(page, /p_apply_to_similar: applyToSimilar/)

console.log('accounting document type learning tests passed')
