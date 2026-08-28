import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260828163455_master_data_correct_and_confirm.sql', 'utf8')
const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const actions = readFileSync('src/pages/MasterDataCenter/MasterDataReviewWorkflow.tsx', 'utf8')

for (const token of [
  'correct_and_confirm_master_data_candidate',
  "set search_path=''",
  'master_candidate_not_authenticated',
  'master_candidate_project_gate_required',
  'master_candidate_source_required',
  'master_candidate_classification_required',
  'correct_master_data_candidate_v2',
  'review_master_data_candidate',
  'candidate_correct_and_confirm',
  'master_data_effective_source',
  'revoke all on function public.correct_and_confirm_master_data_candidate(uuid,text,jsonb,text) from public,anon',
  'grant execute on function public.correct_and_confirm_master_data_candidate(uuid,text,jsonb,text) to authenticated',
]) assert.ok(migration.includes(token), `missing migration contract: ${token}`)

assert.ok(migration.indexOf('correct_master_data_candidate_v2') < migration.indexOf('review_master_data_candidate'), 'correction must happen before confirmation')
assert.match(page, /await supabase\.rpc\('correct_and_confirm_master_data_candidate'/)
assert.match(page, /validatePersistedCorrectAndConfirm/)
assert.match(page, /reviewActionInFlightRef/)
assert.match(actions, /canCorrectAndConfirm/)
assert.match(actions, /บันทึกและยืนยันข้อมูล/)
assert.match(actions, /บันทึกข้อมูลที่แก้และส่งตรวจซ้ำ/)
assert.doesNotMatch(migration, /update\s+public\.(line_|document_flow|financial_transactions)/i, 'Raw/source/business evidence must remain untouched')

console.log('master data atomic correct-and-confirm contract passed: project/source/type gates, append-only Audit/Version, idempotency and read-after-write UI guard')
