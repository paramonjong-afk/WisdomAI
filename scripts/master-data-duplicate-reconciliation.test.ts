import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildMasterReviewProjection } from '../src/services/masterDataReviewWorkflow.ts'
import type { MasterCandidate } from '../src/pages/MasterDataCenter/masterDataReview.ts'

const migration = readFileSync('supabase/migrations/20260826233000_reconcile_confirmed_master_duplicate_groups.sql', 'utf8')
for (const token of [
  'reconcile_confirmed_master_duplicate_group',
  "new.status not in ('confirmed','approved','locked')",
  "candidate.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed')",
  'candidate.normalized_name = new.normalized_name',
  'normalize_master_data_account_last4',
  "status = 'archived'",
  'duplicate_of = new.id',
  'candidate_duplicate_group_reconciled',
  'master_data_candidate_versions',
  'master_data_audit',
  'on conflict(event_key) do nothing',
  'revoke all on function',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(migration, /delete from public\./i)
assert.doesNotMatch(migration, /update public\.(financial_transactions|line_messages|omni_intake_sources)/i)

const base = {
  company_id: 'company-1', entity_type: 'bank_account', display_name: 'นาย พัฒนรัตน์ กันดี', normalized_name: 'นายพัฒนรัตน์กันดี',
  candidate_data: { account_last4: '6995' }, confidence: .95, source_table: 'financial_transactions', source_id: 'source-1', duplicate_of: null,
  review_reason: null, reviewed_by: null, reviewed_at: null, classification_type: 'employee_technician', classification_confidence: .95,
  classification_evidence: [], classification_conflicts: [], classification_version: 'fixture', classified_at: null, created_at: '2026-08-27T00:00:00Z',
} as unknown as MasterCandidate
const canonical = { ...base, id: 'canonical', status: 'confirmed' }
const archivedSibling = { ...base, id: 'sibling', status: 'archived', duplicate_of: 'canonical' }
const projection = buildMasterReviewProjection([canonical, archivedSibling])
assert.equal(projection.active.length, 0)
assert.equal(projection.confirmed.length, 1)

console.log('master-data duplicate reconciliation passed: confirmed canonical closes open siblings without deleting source')
