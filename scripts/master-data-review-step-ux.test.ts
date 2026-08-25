import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMasterDataProjectGateFixture } from '../src/services/masterDataProjectGateFixture.ts'
import { applyLocalProjectGate } from '../src/services/masterDataProjectGate.ts'
import { localReviewReceipt, masterReviewActiveStep, masterReviewBlockers, masterReviewStage } from '../src/services/masterDataReviewWorkflow.ts'

const fixture = createMasterDataProjectGateFixture()
const original = fixture.candidates[1]
const evidence = fixture.evidence[original.id]
assert.equal(fixture.count, 53)
assert.equal(masterReviewStage(original), 'project_pending')
assert.equal(masterReviewActiveStep(original), 0)
assert.ok(masterReviewBlockers(original, '').some((item) => item.includes('Project')))
assert.ok(masterReviewBlockers(original, '').some((item) => item.includes('เหตุผล')))

const eventKey = 'local-project-step-contract'
const projectReady = applyLocalProjectGate(original, 'save_project_candidate', {
  project_name: original.candidate_data.project_name,
  customer_owner_name: original.candidate_data.customer_owner_name,
  site_location: original.candidate_data.site_location,
  responsible_name: original.candidate_data.responsible_name,
  work_type: original.candidate_data.work_type,
  approximate_start_date: original.candidate_data.approximate_start_date,
}, '2026-08-25T12:00:00.000Z', eventKey, 'local-admin')
assert.equal(masterReviewStage(projectReady), 'project_ready')
assert.equal(masterReviewActiveStep(projectReady), 1)
assert.ok(masterReviewBlockers(projectReady, 'ตรวจแล้ว').some((item) => item.includes('Version/Audit')))
const projectReceipt = localReviewReceipt(projectReady)
assert.equal(projectReceipt.projectCandidate?.status, 'awaiting_open_project')
assert.equal(projectReceipt.projectCandidate?.actorId, 'local-admin')
assert.equal(projectReceipt.projectCandidate?.auditEventKey, eventKey)

const correctedAt = '2026-08-25T12:01:00.000Z'
const corrected = {
  ...projectReady,
  status: 'admin_reviewed',
  candidate_data: {
    ...projectReady.candidate_data,
    admin_corrected_at: correctedAt,
    local_correction_version: 1,
    local_correction_audit: [{
      event_key: 'local-correction-step-contract', actor_id: 'local-admin', at: correctedAt,
      before: projectReady, after: { ...projectReady, status: 'admin_reviewed' },
    }],
  },
}
assert.equal(masterReviewStage(corrected), 'awaiting_rereview')
assert.equal(masterReviewActiveStep(corrected), 3)
assert.equal(localReviewReceipt(corrected).correction?.version, 1)
assert.equal(localReviewReceipt(corrected).correction?.beforeData?.status, original.status)
assert.equal(localReviewReceipt(corrected).correction?.afterData?.status, 'admin_reviewed')

const confirmed = { ...corrected, status: 'confirmed' }
assert.equal(masterReviewStage(confirmed), 'confirmed')
assert.equal(masterReviewActiveStep(confirmed), 4)
assert.deepEqual(masterReviewBlockers(confirmed, ''), [])

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const workflow = readFileSync('src/pages/MasterDataCenter/MasterDataReviewWorkflow.tsx', 'utf8') + readFileSync('src/services/masterDataReviewWorkflow.ts', 'utf8')
const projectPanel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')
const receiptLoader = readFileSync('src/services/masterDataReviewReceipts.ts', 'utf8')
for (const token of ['MasterDataReviewProgress', 'MasterDataReviewActions', 'loadMasterDataReviewReceipts', 'Raw/OCR ไม่ถูกเขียนทับ', 'await load()']) assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const label of ['Project รอเลือก', 'Project พร้อม', 'แก้ข้อมูลแล้ว', 'รอตรวจซ้ำ', 'ยืนยันแล้ว', 'ปุ่มยังใช้ไม่ได้', 'Correction Version / Audit', 'Project Candidate บันทึกแล้ว']) assert.match(workflow, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const responsiveContract of ["direction={{ xs: 'column', sm: 'row' }}", "fontSize: { xs: '0.68rem', sm: '0.75rem' }", 'fullWidth variant="contained"']) assert.match(workflow, new RegExp(responsiveContract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(page, /<DialogActions/)
assert.match(projectPanel, /selectedProject \? <Button[\s\S]*ผูก Project เดิม[\s\S]*: <>/)
for (const table of ['master_data_project_candidates', 'master_data_candidate_versions', 'master_data_audit']) assert.match(receiptLoader, new RegExp(table))
assert.ok(evidence.documentId || evidence.intakeId || evidence.messageId, 'fixture must retain Source Reference')

console.log('master data review Step UX passed: 53 fixture rows, Project → Correction/Audit → re-review → confirm, inline blockers and persisted receipt contracts')
