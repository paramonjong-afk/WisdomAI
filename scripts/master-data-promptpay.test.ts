import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const masterData = readFileSync(resolve(root, 'src/pages/MasterDataCenter/index.tsx'), 'utf8')
const accounting = readFileSync(resolve(root, 'src/pages/AccountingDocuments/index.tsx'), 'utf8')

for (const token of [
  "supabase.from('master_payment_aliases')",
  "supabase.from('payment_alias_audit')",
  'PromptPay และช่องทางรับ/จ่าย Canonical',
  'PromptPay รอตรวจ',
  'PromptPay ยืนยันแล้ว',
  '/accounting-documents?transaction_id=',
]) assert.ok(masterData.includes(token), `missing Master Data PromptPay contract: ${token}`)

for (const token of [
  "searchParams.get('transaction_id')",
  'row.transactionId === requestedTransactionId',
  "setAccountingQueueView('slips')",
  'openDeepLinkedSlip(slip)',
]) assert.ok(accounting.includes(token), `missing accounting deep-link contract: ${token}`)

assert.ok(!masterData.includes('alias_fingerprint'), 'Master Data UI must not expose PromptPay fingerprints')
console.log('master data PromptPay contract: PASS')
