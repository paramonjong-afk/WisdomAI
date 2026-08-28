import assert from 'node:assert/strict'
import { emptyPaymentPartyDraft, inferPaymentMethod, normalizePaymentAlias, paymentAliasValidation } from '../src/services/paymentAlias.ts'
import fs from 'node:fs'

assert.equal(inferPaymentMethod('พร้อมเพย์'), 'promptpay')
assert.equal(inferPaymentMethod('Prompt Pay'), 'promptpay')
assert.equal(inferPaymentMethod('SCB'), 'bank_account')
assert.equal(inferPaymentMethod(null), 'unknown')
assert.equal(normalizePaymentAlias('081-234-5678'), '0812345678')
assert.equal(paymentAliasValidation({ paymentMethod: 'promptpay', aliasType: 'mobile', aliasValue: '0812345678' }), null)
assert.equal(paymentAliasValidation({ paymentMethod: 'promptpay', aliasType: 'mobile', aliasValue: '5678' }), null)
assert.match(paymentAliasValidation({ paymentMethod: 'promptpay', aliasType: 'mobile', aliasValue: '12345' }) ?? '', /10 หลัก/)
assert.equal(emptyPaymentPartyDraft('พร้อมเพย์', '2573').aliasValue, '2573')

const migration = fs.readFileSync(new URL('../supabase/migrations/20260828232359_promptpay_canonical_payment_aliases.sql', import.meta.url), 'utf8')
const backfill = fs.readFileSync(new URL('../supabase/migrations/20260828233606_backfill_promptpay_party_links.sql', import.meta.url), 'utf8')
for (const token of [
  'master_payment_aliases', 'financial_transaction_party_links', 'payment_alias_audit',
  'review_transfer_slip_payment_parties_v1', 'alias_fingerprint', 'masked_value',
  "party_role in ('sender','recipient')", "payment_method in ('bank_account','promptpay','unknown')",
  'transfer_slip_payment_parties_reviewed', 'ไม่แก้หลักฐาน OCR เดิม',
]) assert.ok(migration.includes(token), `missing PromptPay contract: ${token}`)
assert.ok(!migration.includes('alias_raw'), 'raw PromptPay identifiers must not be persisted')
for (const token of ['evidence_only', 'promptpay_evidence_backfilled', 'ยังไม่ยืนยันเจ้าของ']) assert.ok(backfill.includes(token), `missing backfill contract: ${token}`)
console.log('promptpay canonical alias contract: PASS')
