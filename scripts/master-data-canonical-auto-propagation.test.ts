import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260828174711_master_data_canonical_auto_propagation.sql', 'utf8')
const conflictMigration = readFileSync('supabase/migrations/20260828175309_mark_canonical_match_conflicts.sql', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')

for (const token of [
  'normalize_master_data_bank',
  'apply_master_data_canonical_match',
  'reprocess_master_data_canonical_matches',
  'auto_apply_master_data_canonical_match',
  "candidate.status in ('confirmed','approved','locked')",
  'candidate.normalized_name = target_row.normalized_name',
  "normalize_master_data_bank(candidate.candidate_data->>'bank_name') = target_bank",
  "normalize_master_data_account_last4(candidate.candidate_data->>'account_last4') = target_account",
  'canonical_count > 1',
  "target_row.classification_type <> canonical_row.classification_type",
  "status = 'archived'",
  'duplicate_of = canonical_row.id',
  'canonical_candidate_id',
  'canonical_match_rule_version',
  'canonical_match_confidence',
  'candidate_canonical_auto_linked',
  'candidate_canonical_match_conflict',
  'master_data_candidate_versions',
  'master_data_audit',
  'pg_trigger_depth() > 1',
  'master_candidate_company_not_found_or_denied',
]) assert.ok(migration.includes(token), `missing canonical propagation contract: ${token}`)

assert.doesNotMatch(migration, /update\s+public\.(financial_transactions|line_messages|document_flow_items|omni_intake_sources)/i)
assert.doesNotMatch(migration, /delete\s+from\s+public\./i)
assert.match(migration, /revoke all on function public\.apply_master_data_canonical_match\(uuid\) from public,anon,authenticated/)
assert.match(migration, /grant execute on function public\.reprocess_master_data_canonical_matches\(uuid,integer\) to authenticated/)

for (const token of ['จับคู่ Canonical', 'Canonical เชื่อมแล้ว', 'ชื่อมาตรฐาน + ธนาคารมาตรฐาน + เลขท้ายบัญชี', 'reprocess_master_data_canonical_matches']) {
  assert.ok(page.includes(token), `missing Master Data UI contract: ${token}`)
}
for (const token of ['append_canonical_match_conflict_flag', 'canonical_match_conflict', 'candidate_canonical_conflict_exposed', 'master_data_candidate_versions', 'master_data_audit']) {
  assert.ok(conflictMigration.includes(token), `missing canonical conflict visibility contract: ${token}`)
}
assert.ok(page.includes('Canonical ขัดแย้ง'))
assert.ok(page.includes('Canonical ซ้ำ/ขัดแย้ง'))
assert.doesNotMatch(conflictMigration, /update\s+public\.(financial_transactions|line_messages|document_flow_items|omni_intake_sources)/i)

console.log('master data canonical auto propagation passed: exact triple, ambiguity/conflict hold, source preservation, Audit/Version and tenant-scoped reprocess')
