import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260831064514_starting_fund_recipient_holder_gate.sql', 'utf8')
const page = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')

assert.match(migration, /resolve_transfer_slip_starting_fund_parties_v1/)
assert.match(migration, /funding_source_type not in \('company_account','personal_reimbursement'\)/)
assert.match(migration, /normalize_employee_payment_name\(transaction_row\.recipient_name\)/)
assert.match(migration, /ไม่พบผู้รับในทะเบียนผู้ถือเงินสำรองจ่าย/)
assert.doesNotMatch(migration, /employment_type='daily'/)
assert.match(migration, /transfer_slip_starting_fund_holder_linked/)
assert.match(migration, /on conflict\(event_key\) do nothing/)
assert.match(migration, /revoke all on function public\.resolve_transfer_slip_starting_fund_parties_v1\(uuid,text,boolean\) from public,anon/)
assert.match(page, /isStartingFund \? 'resolve_transfer_slip_starting_fund_parties_v1' : 'resolve_transfer_slip_advance_parties'/)
assert.match(page, /payerName: isStartingFund \? effectiveLineageDraft\.payerName : holderName/)
assert.match(page, /เงินส่วนตัวผู้โอน → ตั้งต้น\/เติมกองผู้รับ/)
assert.match(page, /ตัวเลือกนี้ไม่ใช่เงินตั้งต้นใหม่/)
assert.match(page, /setSlipAdvancePartyMatch\(null\)/)

console.log('transfer slip starting-fund recipient-holder gate: PASS')
