import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/202608150025_combined_accounting_document_types.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
const webhook = readFileSync('supabase/functions/line-webhook/index.ts', 'utf8')

for (const type of ['receipt_tax_invoice','invoice_tax_invoice','receipt_tax_invoice_abbreviated']) {
  assert.match(migration, new RegExp(type))
  assert.match(page, new RegExp(type))
  assert.match(webhook, new RegExp(type))
}
assert.match(page, /ดูภาพต้นฉบับ/)
assert.match(page, /createSignedUrl\(attachment\.storage_path, 600\)/)
assert.match(page, /contentType\.includes\('pdf'\)/)
assert.match(page, /เปิดเต็มหน้าจอ/)

console.log('accounting combined types and original preview tests passed')
