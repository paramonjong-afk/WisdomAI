import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupDuplicateCandidates, isAccountNameMismatch, isNameMismatch, reviewFilterMatches, type MasterCandidate, type MasterSourceEvidence } from '../src/pages/MasterDataCenter/masterDataReview.ts'

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260823060000_master_data_candidate_review_actions.sql', 'utf8')
const evidence: MasterSourceEvidence = {
  documentId: 'doc-1', intakeId: 'intake-1', messageId: 'msg-1', sourceRoom: 'ไซต์ A', sourceChannel: 'LINE', attachmentId: 'att-1', fileName: 'slip.jpg', bucket: 'line-attachments', path: 'company/slip.jpg', receivedAt: '2026-08-23T08:00:00Z', ocrRawText: 'โอนให้สมนึก', extractedName: 'สมหนึก', extractedAccount: '1234', aiConfidence: 0.82, modelVersion: 'ocr-v2', auditId: 'audit-1',
}
const candidate = (id: string, created: string): MasterCandidate => ({ id, entity_type: 'bank_account', display_name: 'สมนึก', normalized_name: 'สมนึก', candidate_data: { account_last4: '1234' }, confidence: 0.82, status: 'pending_review', source_table: 'financial_transactions', source_id: id, duplicate_of: null, created_at: created })
const rows = [candidate('tx-1', '2026-08-23T08:00:00Z'), candidate('tx-2', '2026-08-23T09:00:00Z'), { ...candidate('tx-3', '2026-08-23T10:00:00Z'), display_name: 'สมหมาย', normalized_name: 'สมหมาย' }]

const groups = groupDuplicateCandidates(rows)
assert.equal(groups.length, 1, 'same normalized name/account should be one summary group')
assert.deepEqual(groups[0].candidateIds, ['tx-1', 'tx-2'], 'duplicate group must retain every source candidate id')
assert.equal(isNameMismatch(candidate('tx-1', evidence.receivedAt!), evidence), true, 'OCR/source name mismatch must be visible')
assert.equal(isAccountNameMismatch(candidate('tx-1', evidence.receivedAt!), evidence), true, 'same account with a different name is account/name mismatch')
assert.equal(reviewFilterMatches(rows[0], evidence, new Set(groups[0].candidateIds), 'duplicate'), true)
assert.equal(reviewFilterMatches(rows[2], evidence, new Set(groups[0].candidateIds), 'duplicate'), false)
assert.equal(reviewFilterMatches(rows[0], evidence, new Set(groups[0].candidateIds), 'pending_review'), true)
assert.match(page, /<Drawer anchor="right"/)
assert.match(page, /ยืนยันข้อเสนอ/)
assert.match(page, /คงข้อมูลเดิม/)
assert.match(page, /จับคู่ Master เดิม/)
assert.match(page, /ขอข้อมูลเพิ่ม/)
assert.match(page, /ปิดการตรวจสอบ/)
assert.match(page, /เปิดแก้ไขแบบควบคุม/)
assert.match(page, /Version \/ controlled correction/)
assert.doesNotMatch(page, /onClick=\{\(\) => void review\(row/)
for (const token of ['provisional', 'needs_review', 'confirmed', 'locked', 'master_data_candidate_versions', 'keep_existing', 'match_master', 'request_info', 'lock', 'controlled_correction', 'master_candidate_reason_required', 'candidate_']) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

console.log('master data candidate local fixture passed: new-data summary, duplicate grouping, mismatch and source audit references')
