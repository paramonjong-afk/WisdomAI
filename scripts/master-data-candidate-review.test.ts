import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupDuplicateCandidates, isAccountNameMismatch, isNameMismatch, resolveCandidateSourceEvidence, reviewFilterMatches, type MasterCandidate, type MasterSourceEvidence } from '../src/pages/MasterDataCenter/masterDataReview.ts'
import { classifyMasterCandidate, masterReviewBucket } from '../src/services/masterDataClassification.ts'

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const standardTable = readFileSync('src/components/StandardDataTable.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260823122058_master_data_candidate_review_actions.sql', 'utf8')
const classificationMigration = readFileSync('supabase/migrations/20260824010000_master_data_classification_review.sql', 'utf8')
const evidence: MasterSourceEvidence = {
  documentId: 'doc-1', intakeId: 'intake-1', messageId: 'msg-1', transactionId: 'tx-1', sourceRoom: 'ไซต์ A', sourceChannel: 'LINE', attachmentId: 'att-1', fileName: 'slip.jpg', bucket: 'line-attachments', path: 'company/slip.jpg', receivedAt: '2026-08-23T08:00:00Z', ocrRawText: 'โอนให้สมนึก', extractedName: 'สมหนึก', extractedAccount: '1234', aiConfidence: 0.82, modelVersion: 'ocr-v2', auditId: 'audit-1', sourceResolved: true, missingReasons: [],
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
const resolved = resolveCandidateSourceEvidence(rows[0], {
  transaction: { id: 'tx-1', source_message_id: 'msg-real-1' },
  flow: { id: 'doc-real-1', intake_id: 'intake-real-1', source_message_id: 'msg-real-1', source_channel: 'line', source_room_name: 'ห้องไซต์ A', source_received_at: '2026-08-23T08:00:00Z' },
  message: { id: 'msg-real-1', line_group_id: 'group-a', file_name: 'slip-real.jpg', occurred_at: '2026-08-23T08:00:00Z' },
  attachment: { id: 'att-real-1', message_id: 'msg-real-1', storage_bucket: 'line-attachments', storage_path: 'company/slip-real.jpg', content_type: 'image/jpeg' },
  event: { id: 'event-real-1' }, audit: { id: 901 },
})
assert.equal(resolved.messageId, 'msg-real-1', 'row and Drawer must use the Message ID resolved from financial transaction source')
assert.equal(resolved.documentId, 'doc-real-1')
assert.equal(resolved.attachmentId, 'att-real-1')
assert.equal(resolved.auditId, '901')
assert.equal(resolved.sourceResolved, true)
const missing = resolveCandidateSourceEvidence(rows[0], { transaction: { id: 'tx-1', source_message_id: null } })
assert.equal(missing.messageId, null, 'transaction id must never be shown as Message ID')
assert.equal(missing.sourceResolved, false)
assert.ok(missing.missingReasons.includes('ไม่พบ Message ID จาก source mapping'))
const classifiedFixture = (id: string, entity_type: string, candidate_data: Record<string, unknown>, confidence = 0.97): MasterCandidate => ({ ...candidate(id, evidence.receivedAt!), entity_type, candidate_data, confidence })
const vendor = classifyMasterCandidate(classifiedFixture('vendor-1', 'vendor', { tax_id: '0105550000001' }), evidence)
const employee = classifyMasterCandidate(classifiedFixture('employee-1', 'employee', { project_id: 'project-1' }), evidence)
const customer = classifyMasterCandidate(classifiedFixture('customer-1', 'customer', { customer_tax_id: '0105550000002' }), evidence)
const internal = classifyMasterCandidate(classifiedFixture('internal-1', 'project', { project_id: 'project-1' }), evidence)
const unknown = classifyMasterCandidate(classifiedFixture('unknown-1', 'bank_account', { account_last4: '4321' }), evidence)
const conflict = classifyMasterCandidate(classifiedFixture('conflict-1', 'employee', { matched_master_type: 'vendor', matched_master_id: 'vendor-1', project_id: 'project-1' }), evidence)
assert.deepEqual([vendor.type, employee.type, customer.type, internal.type, unknown.type], ['vendor', 'employee_technician', 'customer', 'company_internal', 'unknown_review'])
assert.equal(vendor.autoVerified, true, 'high-confidence classification with two independent evidence sources may be auto verified')
assert.equal(unknown.autoVerified, false, 'a name/account alone must not choose a destination')
assert.equal(conflict.type, 'unknown_review', 'conflicting master/entity signals must return to review')
assert.ok(conflict.conflicts.some((item) => item.startsWith('destination_conflict:')))
assert.equal(masterReviewBucket(vendor, true, false), 'duplicate')
assert.equal(masterReviewBucket(conflict, false, false), 'conflict')
assert.equal(masterReviewBucket(unknown, false, false), 'unknown_review')
assert.match(page, /<Drawer anchor="right"/)
assert.match(page, /ยืนยันข้อเสนอ/)
assert.match(page, /คงข้อมูลเดิม/)
assert.match(page, /จับคู่ Master เดิม/)
assert.match(page, /ขอข้อมูลเพิ่ม/)
assert.match(page, /ปิดการตรวจสอบ/)
assert.match(page, /เปิดแก้ไขแบบควบคุม/)
assert.match(page, /Version \/ controlled correction/)
for (const token of ['Auto Classification', 'Auto Verified', 'Review Queue', 'Unknown/Needs Review', 'Confirmed Data Reports', 'Admin Correction', 'correct_master_data_candidate']) assert.match(page, new RegExp(token))
assert.match(page, /onFilteredRowCountChange=\{setReviewVisibleCount\}/)
assert.match(page, /onFilteredRowCountChange=\{setConfirmedVisibleCount\}/)
assert.match(standardTable, /onFilteredRowCountChange\?\.\(filteredRows\.length\)/)
assert.doesNotMatch(page, /source\.messageId \?\? row\.source_id/, 'table must not label Transaction ID as Message ID')
assert.doesNotMatch(page, /onClick=\{\(\) => void review\(row/)
for (const token of ['provisional', 'needs_review', 'confirmed', 'locked', 'master_data_candidate_versions', 'keep_existing', 'match_master', 'request_info', 'lock', 'controlled_correction', 'master_candidate_reason_required', 'candidate_']) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const token of ['auto_verified', 'admin_reviewed', 'classification_type', 'classification_evidence', 'classification_conflicts', 'candidate_auto_classified', 'candidate_admin_corrected', 'master_data_candidate_versions', 'before_data', 'after_data', 'target_reason']) assert.match(classificationMigration, new RegExp(token))

console.log('master data candidate local fixture passed: new-data summary, duplicate grouping, mismatch and source audit references')
