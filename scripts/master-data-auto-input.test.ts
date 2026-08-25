import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildMasterAutoCorrection, detectProjectStartDate, masterAutoRoute } from '../src/services/masterDataAutoInput.ts'
import { projectDraftAuditPayload, projectDraftFromCandidate, validateProjectDraft } from '../src/services/masterDataProjectGate.ts'
import { createMasterDataProjectGateFixture } from '../src/services/masterDataProjectGateFixture.ts'
import { masterReviewStepLabels } from '../src/services/masterDataReviewWorkflow.ts'

const fixture = createMasterDataProjectGateFixture()
const candidate = fixture.candidates[1]
const source = fixture.evidence[candidate.id]
const dated = {
  ...candidate,
  candidate_data: {
    ...candidate.candidate_data,
    first_seen_at: '2026-08-23T08:00:00+07:00',
    project_first_activity_at: '2026-08-22T16:00:00+07:00',
    confirmed_start_date: '2026-08-24',
  },
}
const detected = detectProjectStartDate(dated, source)
assert.equal(detected.date, '2026-08-22', 'earliest related evidence becomes the default start date')
assert.match(detected.source, /กิจกรรมแรก/)

const draft = projectDraftFromCandidate(dated, source)
assert.equal(draft.approximate_start_date, '2026-08-22')
assert.equal(draft.responsible_name, 'Admin Fixture', 'source sender may fill responsible person')
assert.deepEqual(validateProjectDraft(draft, source), { valid: true, missing: [] })
const projectAudit = projectDraftAuditPayload(dated, source, draft)
assert.equal(projectAudit.detected_start_date, '2026-08-22')
assert.equal(projectAudit.confirmed_start_date, '2026-08-22')
assert.equal(projectAudit.start_date_source.source_reference, source.documentId)
assert.match(String(projectAudit.auto_fill_evidence.responsible_name.source), /ผู้ส่งต้นทาง|candidate_data/)

const vendorClassification = {
  type: 'vendor' as const,
  confidence: 0.98,
  evidence: ['tax_id', 'source_reference'],
  conflicts: [],
  reason: 'จัดเป็น vendor จาก tax_id, source_reference',
  autoVerified: true,
  version: 'master-data-rules-v1' as const,
}
const autoCandidate = {
  ...candidate,
  display_name: 'ชื่อ Candidate เดิม',
  confidence: 0.98,
  candidate_data: { ...candidate.candidate_data, account_last4: '1111', bank_name: 'KBank', tax_id: '0105550000000' },
}
const autoSource = { ...source, extractedName: 'ชื่อจาก OCR', extractedAccount: '2222', aiConfidence: 0.98 }
const correction = buildMasterAutoCorrection(autoCandidate, autoSource, vendorClassification)
assert.equal(correction.display_name.status, 'conflict')
assert.equal(correction.account_last4.status, 'conflict')
assert.equal(correction.bank_name.status, 'ready')
assert.equal(correction.tax_id.status, 'ready')
assert.deepEqual(masterAutoRoute('vendor', 0.98, []), {
  destination: 'Accounting / Procurement', owner: 'บัญชีหรือจัดซื้อ', nextAction: 'ตรวจผู้ขายและบัญชีรับเงิน', requiresReview: false,
})
assert.equal(masterAutoRoute('vendor', 0.98, ['account_conflict']).destination, 'Master Data Review')
assert.equal(masterAutoRoute('employee_technician', 0.7, []).requiresReview, true)

assert.deepEqual(masterReviewStepLabels, ['ความสัมพันธ์', 'ตรวจและแก้ข้อมูล', 'ยืนยันและส่งต่อ'])

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const panel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20260825220000_master_data_auto_input_three_step.sql', 'utf8')
for (const token of ['correct_master_data_candidate_v2', 'save_master_data_project_gate_v2', 'validatePersistedCorrection', 'validatePersistedProjectGate', 'await load()']) assert.match(page, new RegExp(token))
for (const token of ['เพิ่ม Project Candidate', 'วันเริ่มโครงการ', 'Auto Input', 'ข้อมูลขัดแย้ง', 'รหัสเหตุการณ์', 'Raw/OCR ไม่ถูกเขียนทับ']) assert.match(panel, new RegExp(token))
for (const token of ['detected_start_date', 'confirmed_start_date', 'start_date_source', 'auto_fill_evidence', 'candidate_auto_input_recorded', 'candidate_project_auto_input_recorded', 'master_candidate_event_key_conflict', "notify pgrst,'reload schema'"]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(migration, /delete\s+from\s+public\.(master_data_candidates|financial_transactions|line_messages|document_flow_items)/i)
assert.doesNotMatch(migration, /update\s+public\.(financial_transactions|line_messages|document_flow_items)/i)

console.log('master data Auto Input passed: 3-step flow, earliest start date, provenance/confidence, conflict gate, route, idempotency tokens and Raw/OCR preservation')
