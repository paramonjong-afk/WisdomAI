import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeAccountLast4 } from '../src/pages/MasterDataCenter/masterDataReview.ts'

const migration = readFileSync('supabase/migrations/20260825211200_fix_master_data_account_last4_confirmation.sql', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const projectPanel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')

assert.equal(normalizeAccountLast4('0856872573'), '2573', 'full PromptPay/account evidence must become the final four digits')
assert.equal(normalizeAccountLast4('xxx-x-x125-73'), '2573', 'formatted account evidence must be normalized before confirmation')
assert.equal(normalizeAccountLast4('2573'), '2573')
assert.equal(normalizeAccountLast4('123'), null, 'fewer than four digits must stay blocked')
assert.equal(normalizeAccountLast4(null), null)

for (const token of [
  'normalize_master_data_account_last4',
  "regexp_replace(coalesce(target_value,''),'[^0-9]','','g')",
  "right(regexp_replace(target_value,'[^0-9]','','g'),4)",
  'master_candidate_account_last4_invalid',
  'correct_master_data_candidate',
  'review_master_data_candidate',
  "account.account_last4=resolved_account_last4",
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

assert.doesNotMatch(migration, /update\s+public\.(financial_transactions|document_flow_items|line_messages)/i, 'raw/source tables must remain unchanged')
assert.match(page, /master_bank_accounts_account_last4_check/)
assert.match(page, /เลขบัญชีจากหลักฐานต้องมีอย่างน้อย 4 หลัก/)
assert.match(page, /กรุณาระบุเลขบัญชีอย่างน้อย 4 หลัก/)
assert.match(projectPanel, /message\.severity === 'error'/, 'a failed confirmation must remain visible inside the active Drawer')

console.log('master data account-last4 confirmation passed: full evidence -> 4-digit master projection, invalid input blocked, raw source unchanged')
