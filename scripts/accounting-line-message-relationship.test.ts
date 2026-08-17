import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
assert.ok(
  page.includes('line_messages!accounting_documents_source_message_id_fkey('),
  'accounting document query must select the direct source-message FK explicitly',
)
assert.ok(
  !page.includes('projects(name),line_messages(line_senders'),
  'ambiguous implicit line_messages relationship must not return',
)
console.log('accounting line-message relationship: ok')
