import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = readFileSync(resolve('supabase/migrations/20260826230000_transfer_slip_vendor_payment_matching.sql'), 'utf8')
const accountingPage = readFileSync(resolve('src/pages/AccountingDocuments/index.tsx'), 'utf8')

assert.match(migration, /create table if not exists public\.transfer_slip_vendor_matches/i)
assert.match(migration, /create table if not exists public\.vendor_bank_account_aliases/i)
assert.match(migration, /unique \(lineage_id, allocation_key\)/i)
assert.match(migration, /save_transfer_slip_vendor_match_v1/i)
assert.match(migration, /transfer_slip_vendor_match_review/i)
assert.match(migration, /vendor_payment_match_required/i)
assert.match(migration, /enable row level security/i)
assert.match(migration, /revoke all on function public\.save_transfer_slip_vendor_match_v1/i)

assert.match(accountingPage, /vendorId/i)
assert.match(accountingPage, /vendorMatchStatus/i)
assert.match(accountingPage, /save_transfer_slip_vendor_match_v1/i)
assert.match(accountingPage, /vendor_payment/i)
assert.match(accountingPage, /vendorMatchStatus === 'matched'/i)

console.log('vendor payment matching migration/UI contract: PASS')
