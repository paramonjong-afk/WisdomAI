import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reviewFilterMatches } from '../src/pages/MasterDataCenter/masterDataReview.ts'
import { applyLocalProjectGate, autoSelectedProjectId, findProjectMatches, isProjectGateReady, projectDraftFromCandidate, projectGateStatus, validateProjectDraft } from '../src/services/masterDataProjectGate.ts'
import { createMasterDataProjectGateFixture } from '../src/services/masterDataProjectGateFixture.ts'

const fixture = createMasterDataProjectGateFixture()
assert.equal(fixture.count, 53, 'local regression dataset must stay deterministic at 53 pending candidates')
assert.equal(fixture.candidates.filter((row) => reviewFilterMatches(row, fixture.evidence[row.id], new Set(), 'pending_review')).length, 53, 'tab/count and pending rows must use the same predicate')

const existing = fixture.candidates[0]
const existingEvidence = fixture.evidence[existing.id]
const matches = findProjectMatches(existing, existingEvidence, fixture.projects)
assert.equal(matches[0]?.project.id, 'fixture-project-panthong', 'project name/site/source room should match an existing company Project')
assert.ok(matches[0].evidence.length >= 1)
assert.equal(autoSelectedProjectId(existing, matches), fixture.projects[0].id, 'strong Project evidence may preselect the existing Project')
const linked = applyLocalProjectGate(existing, 'link_existing_project', { project_id: matches[0].project.id, project_name: matches[0].project.name, match_evidence: matches[0].evidence }, '2026-08-25T04:00:00Z')
assert.equal(projectGateStatus(linked), 'linked_existing_project')
assert.equal(isProjectGateReady(linked), true)
assert.equal((linked.candidate_data.local_project_gate_audit as unknown[]).length, 1, 'local action must preserve append-only audit evidence')
assert.equal(linked.candidate_data.local_project_gate_version, 1)

const newProject = fixture.candidates[1]
const completeDraft = projectDraftFromCandidate(newProject, fixture.evidence[newProject.id])
assert.equal(completeDraft.approximate_start_date, '2026-08-25', 'start date should come from the earliest related evidence without manual input')
const weakMatches = findProjectMatches(newProject, fixture.evidence[newProject.id], fixture.projects)
assert.equal(autoSelectedProjectId(newProject, weakMatches), '', 'one weak evidence point must not auto-link a new Project Candidate to an existing Project')
assert.deepEqual(validateProjectDraft(completeDraft, fixture.evidence[newProject.id]), { valid: true, missing: [] })
const pendingProject = applyLocalProjectGate(newProject, 'save_project_candidate', completeDraft, '2026-08-25T04:01:00Z')
assert.equal(projectGateStatus(pendingProject), 'awaiting_new_project')
assert.equal(isProjectGateReady(pendingProject), true, 'a complete Project Candidate may pass classification without creating a real Project')
assert.match(String(pendingProject.candidate_data.project_candidate_id), /^local-project-candidate-/)

const incomplete = fixture.candidates[2]
const invalid = validateProjectDraft(projectDraftFromCandidate(incomplete, fixture.evidence[incomplete.id]), fixture.evidence[incomplete.id])
assert.equal(invalid.valid, false)
for (const required of ['ชื่อโครงการ', 'ลูกค้าหรือเจ้าของงาน', 'ไซต์/สถานที่', 'ประเภทงาน']) assert.ok(invalid.missing.includes(required))
assert.ok(!invalid.missing.includes('ผู้รับผิดชอบ'), 'source sender should auto-fill responsible person')
assert.ok(!invalid.missing.includes('วันที่เริ่มโดยประมาณ'), 'source received date should auto-fill approximate start date')
assert.equal(isProjectGateReady(incomplete), false, 'received candidates must not be confirmable')

const corrected = { ...linked, status: 'admin_reviewed' }
assert.equal(reviewFilterMatches(corrected, existingEvidence, new Set(), 'pending_review'), true, 'Admin correction stays visible until explicit confirmation')
const confirmed = { ...linked, status: 'confirmed', candidate_data: { ...linked.candidate_data, project_gate_status: 'confirmed' } }
const after = fixture.candidates.map((row) => row.id === confirmed.id ? confirmed : row)
assert.equal(after.filter((row) => reviewFilterMatches(row, fixture.evidence[row.id], new Set(), 'pending_review')).length, 52, 'successful confirmation removes exactly one row from pending count')

const page = readFileSync('src/pages/MasterDataCenter/index.tsx', 'utf8')
const panel = readFileSync('src/pages/MasterDataCenter/MasterDataProjectGatePanel.tsx', 'utf8')
const workflow = readFileSync('src/pages/MasterDataCenter/MasterDataReviewWorkflow.tsx', 'utf8') + readFileSync('src/services/masterDataReviewWorkflow.ts', 'utf8')
const projectService = readFileSync('src/services/masterDataProjectGate.ts', 'utf8')
const migration = readFileSync('supabase/migrations/20260825105559_master_data_project_first_gate.sql', 'utf8')
for (const token of ['LOCAL TEST DATA', 'MasterDataProjectGatePanel', 'save_master_data_project_gate', 'MasterDataReviewActions']) assert.match(page, new RegExp(token))
for (const token of ['linked_existing_project', 'awaiting_new_project']) assert.match(projectService, new RegExp(token))
for (const token of ['Project-first Gate', 'ผูก Project เดิม', 'เพิ่ม Project Candidate', 'ข้อมูลที่ยังขาด', 'เปิดต้นทาง']) assert.match(panel, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
for (const token of ['ขอข้อมูลเพิ่ม', 'กลับคิว', 'รายการถัดไป']) assert.match(workflow, new RegExp(token))
assert.doesNotMatch(page, /<Drawer anchor="bottom"/, 'validation/actions must not render in a second overlapping Drawer')
for (const token of ['master_data_project_candidates', 'awaiting_open_project', 'save_master_data_project_gate', 'linked_existing_project', 'awaiting_information', 'master_data_candidate_versions', 'master_data_audit', 'before_data', 'after_data', 'is_company_manager', 'enable row level security', 'master_candidate_project_gate_required', "'replayed',true", 'master_candidate_event_key_conflict']) assert.match(migration, new RegExp(token))
assert.match(migration, /revoke all on function public\.save_master_data_project_gate/)
assert.doesNotMatch(migration, /delete from public\.(master_data_candidates|financial_transactions|line_messages|document_flow_items)/i)

console.log('master data Project-first Gate fixture passed: 53 -> 52 after explicit confirm; existing/new/missing/audit/version/count contracts verified')
