import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260828224845_sync_confirmed_transfer_parties_to_canonical_master.sql', 'utf8')
const reconciliation = readFileSync('supabase/migrations/20260828225159_reconcile_canonical_bank_account_duplicates.sql', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')

for (const token of [
  'tmbthanachartbank',
  'sync_confirmed_transfer_party_to_canonical_master',
  'sync_confirmed_transfer_parties_to_canonical_master_after_review',
  "route_status in ('routed','accounting_review','closed')",
  "review_status in ('duplicate','dismissed')",
  'pg_advisory_xact_lock',
  'account_fingerprint',
  'canonical_bank_account_id',
  "'canonical_match_status','linked'",
  "'canonical_match_status','conflict'",
  'candidate_linked_to_confirmed_transfer_canonical',
  'candidate_conflicts_with_confirmed_transfer_canonical',
  'master_data_candidate_versions',
  'master_data_audit',
  'source_immutable',
]) assert.ok(migration.includes(token), `missing confirmed-slip canonical contract: ${token}`)

assert.doesNotMatch(migration, /delete\s+from\s+public\./i)
assert.doesNotMatch(migration, /update\s+public\.(financial_transactions|line_messages|document_flow_items|omni_intake_sources)/i)
assert.match(migration, /revoke all on function public\.sync_confirmed_transfer_party_to_canonical_master[\s\S]+from public,anon,authenticated/)

for (const token of [
  'canonical_bank_account_duplicate_archived',
  'verification_status=\'archived\'',
  'master_data_transfer_party_reviews',
  'transfer_slip_advance_party_links',
  'canonical_bank_account_id',
  'canonical_row.account_fingerprint is null',
  'confirmed_transfer_canonical_lookup_block_not_found',
]) assert.ok(reconciliation.includes(token), `missing legacy canonical reconciliation contract: ${token}`)
assert.doesNotMatch(reconciliation, /delete\s+from\s+public\./i)

for (const token of ['Canonical ID', 'สลิปที่ Admin ยืนยัน']) {
  assert.ok(page.includes(token), `missing canonical UI explanation: ${token}`)
}

console.log('confirmed transfer slip canonical sync passed: one canonical source, idempotent backfill, conflict hold, immutable evidence and Audit/Version')
