import { CompareArrowsOutlined, OpenInNewOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, DialogContent, DialogTitle, Divider, Drawer, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { classificationLabel, classifyMasterCandidate, type MasterClassificationType } from '../../services/masterDataClassification'
import { emptyMasterSourceEvidence, loadMasterSourceEvidence } from '../../services/masterDataSourceGateway'
import { applyLocalProjectGate, isProjectGateReady, projectGateStatus, type MasterProjectOption } from '../../services/masterDataProjectGate'
import { createMasterDataProjectGateFixture } from '../../services/masterDataProjectGateFixture'
import { loadMasterDataReviewReceipts } from '../../services/masterDataReviewReceipts'
import { localReviewReceipt, type MasterReviewReceipt } from '../../services/masterDataReviewWorkflow'
import { userError } from '../../utils/userError'
import { MasterDataProjectGatePanel, type ProjectGateAction } from './MasterDataProjectGatePanel'
import { MasterDataReviewActions, MasterDataReviewProgress } from './MasterDataReviewWorkflow'
import { candidateAccount, groupDuplicateCandidates, isNameMismatch, mismatchStage, reviewFilterMatches, type MasterCandidate, type MasterReviewFilter, type MasterSourceEvidence } from './masterDataReview'

type Candidate = MasterCandidate & { archive_after: string }
type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string; verification_status: string; verified_at: string | null; created_at: string }

const candidateStatus: Record<string, string> = { provisional: 'รับเข้า', auto_verified: 'Auto Verified', admin_reviewed: 'Admin แก้แล้ว/รอตรวจซ้ำ', needs_review: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', locked: 'Locked', pending_review: 'รอตรวจสอบ', approved: 'ยืนยันแล้ว', rejected: 'ยกเลิก', archived: 'เก็บถาวร', needs_more_info: 'รอข้อมูลเพิ่ม' }
const accountStatus: Record<string, string> = { verified: 'ยืนยันแล้ว', unverified: 'รอตรวจ', inactive: 'ปิดใช้งาน', archived: 'เก็บถาวร' }
const entityLabel: Record<string, string> = { employee: 'พนักงาน', vendor: 'ผู้ขาย', customer: 'ลูกค้า', project: 'โครงการ', work_package: 'งานย่อย', bank_account: 'บัญชีธนาคาร' }
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const emptyEvidence = emptyMasterSourceEvidence

export function MasterDataCenterPage() {
  usePageTitle('ศูนย์ข้อมูลกลาง')
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const localTestData = new URLSearchParams(window.location.search).get('local_test_data') === '1'
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [evidence, setEvidence] = useState<Record<string, MasterSourceEvidence>>({})
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [projects, setProjects] = useState<MasterProjectOption[]>([])
  const [reviewReceipts, setReviewReceipts] = useState<Record<string, MasterReviewReceipt>>({})
  const [error, setError] = useState('')
  const [drawerMessage, setDrawerMessage] = useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [savingId, setSavingId] = useState('')
  const [filter, setFilter] = useState<MasterReviewFilter>('pending_review')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({})
  const [reportType, setReportType] = useState<MasterClassificationType | 'all'>('all')
  const [reportDate, setReportDate] = useState('')
  const [reviewVisibleCount, setReviewVisibleCount] = useState(0)
  const [confirmedVisibleCount, setConfirmedVisibleCount] = useState(0)
  const [correction, setCorrection] = useState({ display_name: '', classification_type: 'unknown_review' as MasterClassificationType, account_last4: '', bank_name: '', tax_id: '' })
  const setSourceUrl = (value: string) => { void value }

  const load = useCallback(async () => {
    if (localTestData) {
      const fixture = createMasterDataProjectGateFixture()
      setCandidates(fixture.candidates)
      setEvidence(fixture.evidence)
      setProjects(fixture.projects)
      setAccounts([])
      setReviewerNames({})
      setReviewReceipts(Object.fromEntries(fixture.candidates.map((candidate) => [candidate.id, localReviewReceipt(candidate)])))
      setError('')
      return
    }
    if (!companyId) return
    const [candidateResult, accountResult, projectResult] = await Promise.all([
      supabase.from('master_data_candidates').select('id,entity_type,display_name,normalized_name,candidate_data,confidence,status,source_table,source_id,duplicate_of,review_reason,reviewed_by,reviewed_at,classification_type,classification_confidence,classification_evidence,classification_conflicts,classification_version,classified_at,created_at,archive_after').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4,verification_status,verified_at,created_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
      supabase.from('projects').select('id,name,code,status,project_name,developer_name,province,location_detail,property_type').eq('company_id', companyId).eq('status', 'active').order('name'),
    ])
    const loadError = candidateResult.error ?? accountResult.error ?? projectResult.error
    if (loadError) { setError(userError(loadError)); return }
    const rows = (candidateResult.data ?? []) as Candidate[]
    setCandidates(rows)
    setAccounts((accountResult.data ?? []) as BankAccount[])
    setProjects((projectResult.data ?? []) as MasterProjectOption[])
    const reviewerIds = [...new Set(rows.map((row) => row.reviewed_by).filter((id): id is string => Boolean(id)))]
    if (reviewerIds.length) {
      const reviewerResult = await supabase.from('profiles').select('id,full_name').in('id', reviewerIds)
      if (!reviewerResult.error) setReviewerNames(Object.fromEntries((reviewerResult.data ?? []).map((row) => [row.id, row.full_name])))
    } else setReviewerNames({})
    const sourceResult = await loadMasterSourceEvidence(rows)
    setEvidence(sourceResult.data)
    const receiptResult = await loadMasterDataReviewReceipts(rows.map((row) => row.id))
    setReviewReceipts(receiptResult.data)
    setError(sourceResult.error ? `โหลด Source Reference ไม่ครบ: ${userError(sourceResult.error)}` : receiptResult.error ? `โหลด Audit/Version ไม่ครบ: ${userError(receiptResult.error)}` : '')
  }, [companyId, localTestData])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const review = async (candidate: Candidate, action: 'approve' | 'reject' | 'archive' | 'keep_existing' | 'match_master' | 'request_info' | 'lock' | 'controlled_correction') => {
    if (reviewReason.trim().length < 3 && action !== 'archive') { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรใน Drawer' }); return }
    if (['approve', 'keep_existing', 'match_master', 'lock'].includes(action) && !isProjectGateReady(candidate)) { setDrawerMessage({ severity: 'error', text: 'ต้องผูก Project เดิมหรือบันทึก Project Candidate ให้ครบก่อนยืนยันรายการ' }); return }
    if (['approve', 'keep_existing', 'match_master', 'lock'].includes(action) && candidate.status !== 'admin_reviewed') { setDrawerMessage({ severity: 'error', text: 'ต้องบันทึกฉบับแก้ไขและส่งเข้ารอตรวจซ้ำก่อนยืนยันรายการ' }); return }
    if (localTestData) {
      const status = action === 'approve' || action === 'keep_existing' || action === 'match_master' ? 'confirmed' : action === 'reject' ? 'rejected' : action === 'archive' ? 'archived' : action === 'lock' ? 'locked' : action === 'request_info' ? 'needs_more_info' : 'needs_review'
      const updated = { ...candidate, status, review_reason: reviewReason.trim() || null, reviewed_at: new Date().toISOString(), candidate_data: { ...candidate.candidate_data, ...(status === 'confirmed' || status === 'locked' ? { project_gate_resolution: projectGateStatus(candidate), project_gate_status: 'confirmed' } : {}), local_review_action: action } }
      const nextRows = candidates.map((row) => row.id === updated.id ? updated : row)
      setCandidates(nextRows)
      setReviewReason('')
      const next = nextRows.find((row) => row.id !== updated.id && ['provisional', 'auto_verified', 'admin_reviewed', 'needs_review', 'pending_review', 'needs_more_info'].includes(row.status)) ?? null
      if (next) { openCandidate(next); setDrawerMessage({ severity: 'success', text: `Local fixture: ${candidateStatus[status] ?? status} แล้ว และเปิดรายการถัดไป` }) } else { setSelected(null); setDrawerMessage(null) }
      return
    }
    setSavingId(candidate.id); setDrawerMessage(null); setError('')
    const { data: reviewedData, error: rpcError } = await supabase.rpc('review_master_data_candidate', { target_candidate_id: candidate.id, target_event_key: crypto.randomUUID(), target_action: action, target_reason: reviewReason.trim() || null })
    setSavingId('')
    if (rpcError) { setDrawerMessage({ severity: 'error', text: userError(rpcError) }); return }
    const reviewed = reviewedData as Candidate | null
    const leavesQueue = reviewed ? ['confirmed', 'approved', 'locked', 'rejected', 'archived'].includes(reviewed.status) : ['approve', 'keep_existing', 'match_master', 'lock', 'reject', 'archive'].includes(action)
    const next = leavesQueue ? candidates.find((row) => row.id !== candidate.id && ['provisional', 'auto_verified', 'admin_reviewed', 'needs_review', 'pending_review', 'needs_more_info'].includes(row.status)) ?? null : reviewed
    setReviewReason('')
    if (next) { openCandidate(next); setDrawerMessage({ severity: 'success', text: `${candidateStatus[reviewed?.status ?? ''] ?? 'บันทึกสำเร็จ'} · รีเฟรชคิวแล้วและเปิดรายการถัดไป` }) } else { setSelected(null); setDrawerMessage(null) }
    await load()
  }
  const openSource = async (candidate: Candidate) => {
    const source = evidence[candidate.id] ?? emptyEvidence()
    if (!source.bucket || !source.path) { setDrawerMessage({ severity: 'error', text: 'ไม่พบไฟล์ต้นฉบับของรายการนี้ กรุณาใช้ Document/Message ID ใน Source Reference ตรวจต้นทาง' }); return }
    const signed = await documentFlowGateway.signedPreviewUrl(source.bucket, source.path)
    if (signed.error || !signed.data?.signedUrl) { setDrawerMessage({ severity: 'error', text: `เปิดไฟล์ต้นฉบับไม่สำเร็จ: ${userError(signed.error)}` }); return }
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const openCandidate = (candidate: Candidate) => {
    setSelected(candidate)
    setReviewReason('')
    setDrawerMessage(null)
    setCorrection({ display_name: candidate.display_name, classification_type: (candidate.classification_type as MasterClassificationType | null) ?? 'unknown_review', account_last4: candidateAccount(candidate) ?? '', bank_name: String(candidate.candidate_data.bank_name ?? ''), tax_id: String(candidate.candidate_data.tax_id ?? '') })
  }
  const correctCandidate = async () => {
    if (!selected || reviewReason.trim().length < 3) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษรใน Drawer' }); return }
    if (localTestData) {
      const now = new Date().toISOString()
      const eventKey = `local-correction-${selected.id}-${Date.parse(now)}`
      const afterData = { ...selected, display_name: correction.display_name.trim() || selected.display_name, classification_type: correction.classification_type, status: 'admin_reviewed', review_reason: reviewReason.trim(), reviewed_at: now }
      const updated = { ...afterData, candidate_data: { ...selected.candidate_data, ...correction, admin_corrected_at: now, admin_corrected_by: 'local-admin', local_correction_version: Number(selected.candidate_data.local_correction_version ?? 0) + 1, local_correction_audit: [...(Array.isArray(selected.candidate_data.local_correction_audit) ? selected.candidate_data.local_correction_audit : []), { event_key: eventKey, actor_id: 'local-admin', at: now, before: selected, after: afterData }] } }
      setSelected(updated); setCandidates((current) => current.map((row) => row.id === updated.id ? updated : row)); setReviewReceipts((current) => ({ ...current, [updated.id]: localReviewReceipt(updated) })); setDrawerMessage({ severity: 'success', text: 'Local fixture: append ฉบับแก้ไข/Version/Audit แล้ว รายการเปลี่ยนเป็นรอตรวจซ้ำ' }); return
    }
    setSavingId(selected.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    const beforeData = selected
    const { data: correctedData, error: correctionError } = await supabase.rpc('correct_master_data_candidate', { target_candidate_id: selected.id, target_event_key: eventKey, target_correction: correction, target_reason: reviewReason.trim() })
    setSavingId('')
    if (correctionError) { setDrawerMessage({ severity: 'error', text: userError(correctionError) }); return }
    if (correctedData) { const updated = correctedData as Candidate; setSelected(updated); setCandidates((current) => current.map((row) => row.id === updated.id ? updated : row)); setReviewReceipts((current) => ({ ...current, [updated.id]: { projectCandidate: current[updated.id]?.projectCandidate ?? null, correction: { version: null, actorId: updated.reviewed_by ?? null, timestamp: updated.reviewed_at ?? null, auditEventKey: eventKey, beforeData, afterData: updated } } })) }
    setDrawerMessage({ severity: 'success', text: 'บันทึกฉบับแก้ไขแล้ว รายการยังอยู่ในคิวจนกว่าจะผ่าน Project-first Gate และกดยืนยันข้อเสนอ' })
    await load()
  }
  const saveProjectGate = async (action: ProjectGateAction, payload: Record<string, unknown>) => {
    if (!selected) return
    if (reviewReason.trim().length < 3) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรก่อนบันทึก Project Gate' }); return }
    if (localTestData) {
      const updated = applyLocalProjectGate(selected, action, payload, new Date().toISOString(), crypto.randomUUID(), 'local-admin')
      setSelected(updated as Candidate); setCandidates((current) => current.map((row) => row.id === updated.id ? updated as Candidate : row))
      setReviewReceipts((current) => ({ ...current, [updated.id]: localReviewReceipt(updated) }))
      setDrawerMessage({ severity: 'success', text: action === 'link_existing_project' ? 'Local fixture: ผูก Project เดิมและ append Audit/Version แล้ว' : action === 'save_project_candidate' ? 'Local fixture: สร้าง Project Candidate รอเปิดโครงการและ append Audit/Version แล้ว' : action === 'request_information' ? 'Local fixture: ส่งไปรอข้อมูลเพิ่มแล้ว' : 'Local fixture: ส่งกลับคิวตรวจแล้ว' })
      return
    }
    setSavingId(selected.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    const { data, error: gateError } = await supabase.rpc('save_master_data_project_gate', { target_candidate_id: selected.id, target_event_key: eventKey, target_action: action, target_payload: payload, target_reason: reviewReason.trim() })
    setSavingId('')
    if (gateError) { setDrawerMessage({ severity: 'error', text: userError(gateError) }); return }
    const result = data && typeof data === 'object' ? data as { candidate?: Candidate; project_candidate?: { id: string; status: string; version_no: number; updated_by: string | null; updated_at: string } | null } : null
    const updated = result?.candidate ?? null
    if (updated) { setSelected(updated); setCandidates((current) => current.map((row) => row.id === updated.id ? updated : row)); if (result?.project_candidate) setReviewReceipts((current) => ({ ...current, [updated.id]: { correction: current[updated.id]?.correction ?? null, projectCandidate: { id: result.project_candidate!.id, status: result.project_candidate!.status, version: result.project_candidate!.version_no, actorId: result.project_candidate!.updated_by, timestamp: result.project_candidate!.updated_at, auditEventKey: eventKey } } })) }
    setDrawerMessage({ severity: 'success', text: action === 'link_existing_project' ? 'ผูก Project เดิมแล้ว สามารถตรวจและยืนยันข้อเสนอได้' : action === 'save_project_candidate' ? 'บันทึก Project Candidate แล้ว โดยยังไม่ได้สร้าง Project จริงอัตโนมัติ' : action === 'request_information' ? 'ส่งรายการไปรอข้อมูลเพิ่มแล้ว' : 'ส่งรายการกลับคิวตรวจแล้ว' })
    await load()
  }
  const pending = candidates.filter((item) => ['provisional', 'admin_reviewed', 'needs_review', 'pending_review', 'needs_more_info'].includes(item.status)).length
  const duplicateGroups = useMemo(() => groupDuplicateCandidates(candidates), [candidates])
  const duplicateIds = useMemo(() => new Set(duplicateGroups.flatMap((group) => group.candidateIds)), [duplicateGroups])
  const classifications = useMemo(() => Object.fromEntries(candidates.map((candidate) => [candidate.id, classifyMasterCandidate(candidate, evidence[candidate.id] ?? emptyEvidence(), duplicateIds.has(candidate.id))])), [candidates, duplicateIds, evidence])
  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    const classification = classifications[candidate.id]
    if (filter === 'conflict') return classification.conflicts.length > 0
    if (filter === 'unknown_review') return classification.type === 'unknown_review'
    return reviewFilterMatches(candidate, evidence[candidate.id] ?? null, duplicateIds, filter)
  }), [candidates, classifications, duplicateIds, evidence, filter])
  const summaryRows = useMemo(() => {
    const grouped = new Set<string>()
    return filteredCandidates.filter((candidate) => {
      const group = duplicateGroups.find((item) => item.candidateIds.includes(candidate.id))
      if (!group) return true
      if (grouped.has(group.key)) return false
      grouped.add(group.key)
      return true
    })
  }, [duplicateGroups, filteredCandidates])
  const openNextCandidate = () => {
    if (!selected || summaryRows.length < 2) return
    const currentIndex = summaryRows.findIndex((row) => row.id === selected.id)
    openCandidate(summaryRows[(currentIndex + 1 + summaryRows.length) % summaryRows.length])
  }
  const confirmedRows = useMemo(() => candidates.filter((candidate) => ['confirmed', 'approved', 'locked'].includes(candidate.status)).filter((candidate) => reportType === 'all' || classifications[candidate.id].type === reportType).filter((candidate) => !reportDate || candidate.reviewed_at?.slice(0, 10) === reportDate), [candidates, classifications, reportDate, reportType])
  const conflictCount = candidates.filter((candidate) => classifications[candidate.id].conflicts.length > 0).length
  const adminReviewed = candidates.filter((candidate) => candidate.status === 'admin_reviewed').length
  const autoVerified = candidates.filter((candidate) => candidate.status === 'auto_verified' || classifications[candidate.id].autoVerified).length
  const confirmedCount = candidates.filter((candidate) => ['confirmed', 'approved', 'locked'].includes(candidate.status)).length

  return <Stack spacing={2}>
    <PageHeader title="ศูนย์ข้อมูลกลาง" description="ข้อมูลจากสลิปและเอกสารจะเข้ารอตรวจ ก่อนยืนยันเป็นข้อมูลใช้ร่วมกันทุก Module · ไม่มีการลบข้อมูลที่มีการอ้างอิง" action={<Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button>} />
    {localTestData && <Alert severity="info">LOCAL TEST DATA · master-data-project-first-v1 · 53 รายการ · ไม่มีการอ่านหรือเขียน Production</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Metric label="ข้อมูลใหม่" value={`${candidates.filter((item) => ['provisional', 'pending_review'].includes(item.status)).length} รายการ`} /><Metric label="Auto Verified" value={`${autoVerified} รายการ`} /><Metric label="รอตรวจ" value={`${pending} รายการ`} /><Metric label="ขัดแย้ง" value={`${conflictCount} รายการ`} /><Metric label="ยืนยันแล้ว" value={`${confirmedCount} รายการ`} /><Metric label="แก้ไขโดย Admin" value={`${adminReviewed} รายการ`} /></Stack>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">มุมมองนี้สรุปข้อมูลใหม่เป็นกลุ่ม ไม่แสดง OCR ซ้ำเป็นหลายแถว ระบบไม่ auto-merge และการยืนยัน/ปฏิเสธยังบันทึก before/after, actor, เวลา และ source ลง Audit</Typography></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}><Typography variant="h6" sx={{ flex: 1 }}>Review Queue</Typography><Select size="small" value={filter} onChange={(event) => setFilter(event.target.value as MasterReviewFilter)}><MenuItem value="pending_review">รอตรวจ</MenuItem><MenuItem value="duplicate">ซ้ำ</MenuItem><MenuItem value="name_mismatch">ชื่อไม่ตรง</MenuItem><MenuItem value="account_name_mismatch">บัญชีตรงแต่ชื่อไม่ตรง</MenuItem><MenuItem value="conflict">ข้อมูลขัดแย้ง</MenuItem><MenuItem value="unknown_review">Unknown/Needs Review</MenuItem><MenuItem value="all">ทั้งหมด</MenuItem></Select><Chip label={`${reviewVisibleCount} กลุ่ม/รายการ`} /></Stack>
    <StandardDataTable rows={summaryRows} onFilteredRowCountChange={setReviewVisibleCount} getRowId={(row) => row.id} onRowClick={openCandidate} getSearchText={(row) => `${row.display_name} ${entityLabel[row.entity_type] ?? row.entity_type} ${classificationLabel[classifications[row.id].type]} ${candidateAccount(row) ?? ''} ${row.source_id ?? ''} ${evidence[row.id]?.messageId ?? ''}`} searchLabel="ค้นหาชื่อ บัญชี ประเภท Source ID หรือ Message ID" emptyText="ยังไม่มีข้อมูลตามตัวกรอง" minWidth={1460} columns={[
      { id: 'type', label: 'ประเภท', minWidth: 130, render: (row) => entityLabel[row.entity_type] ?? row.entity_type },
      { id: 'classification', label: 'Auto Classification', minWidth: 200, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{classificationLabel[classifications[row.id].type]}</Typography><Typography variant="caption" color="text.secondary">{Math.round(classifications[row.id].confidence * 100)}% · {classifications[row.id].version}</Typography></Stack> },
      { id: 'name', label: 'ข้อมูลใหม่ / ชื่อ', minWidth: 240, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{row.display_name}</Typography>{isNameMismatch(row, evidence[row.id] ?? null) && <Chip size="small" color="error" label={`ผิดที่ ${mismatchStage(row, evidence[row.id] ?? null)}`} />}</Stack> },
      { id: 'bank', label: 'บัญชีจากหลักฐาน', minWidth: 230, render: (row) => row.entity_type === 'bank_account' ? `•••• ${candidateAccount(row) ?? '-'}` : '-' },
      { id: 'duplicate', label: 'Duplicate Group', minWidth: 180, render: (row) => { const group = duplicateGroups.find((item) => item.candidateIds.includes(row.id)); return group ? <Chip size="small" color="warning" label={`${group.candidateIds.length} ต้นทาง`} /> : 'ไม่ซ้ำ' } },
      { id: 'source', label: 'Source Reference', minWidth: 300, render: (row) => { const source = evidence[row.id] ?? emptyEvidence(); return <Stack spacing={0.2}><Typography variant="caption">Document/Intake: {source.documentId ?? source.intakeId ?? 'ไม่พบ mapping'}</Typography><Typography variant="caption">Room: {source.sourceRoom ?? 'ไม่พบห้อง'} · Message: {source.messageId ?? 'ไม่พบ Message ID'}</Typography><Typography variant="caption">เข้า: {dateTime(source.receivedAt ?? row.created_at)}</Typography>{!source.sourceResolved && <Chip size="small" color="warning" label="Source ไม่ครบ" />}</Stack> } },
      { id: 'confidence', label: 'ความมั่นใจ AI', minWidth: 130, render: (row) => row.confidence == null ? '-' : `${Math.round(row.confidence * 100)}%` },
      { id: 'created', label: 'พบเมื่อ', minWidth: 170, render: (row) => dateTime(row.created_at) },
      { id: 'status', label: 'สถานะข้อมูล', minWidth: 190, render: (row) => <Chip size="small" color={['confirmed', 'approved', 'auto_verified'].includes(row.status) ? 'success' : row.status === 'locked' ? 'primary' : row.status === 'rejected' ? 'error' : row.status === 'archived' ? 'default' : 'warning'} label={candidateStatus[row.status] ?? row.status} /> },
      { id: 'actions', label: 'ตรวจรายละเอียด', minWidth: 170, render: (row) => <Button size="small" startIcon={<CompareArrowsOutlined />} onClick={(event) => { event.stopPropagation(); openCandidate(row) }}>เปิด Detail</Button> },
    ]} />
    <Drawer anchor="right" open={Boolean(selected)} onClose={() => { setSelected(null); setSourceUrl(''); setReviewReason('') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 680 }, maxWidth: '100vw' } } }}><DialogTitle>ตรวจข้อมูลใหม่ · {selected?.display_name}</DialogTitle><DialogContent dividers>{selected && <Stack spacing={1.25}><MasterDataReviewProgress candidate={selected} receipt={reviewReceipts[selected.id] ?? { projectCandidate: null, correction: null }} reason={reviewReason} actorName={(id) => id ? reviewerNames[id] ?? id : '-'} /><TextField multiline minRows={2} label="เหตุผล (บังคับสำหรับทุกการยืนยัน/แก้ไข/ตัดสินใจ)" value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /><Typography variant="body2" color="text.secondary">Candidate ID: {selected.id} · source_table: {selected.source_table ?? '-'} · source_id: {selected.source_id ?? '-'}</Typography><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Current Master</Typography><Typography variant="body2">ชื่อ: {(selected.candidate_data.master_name as string | undefined) ?? 'ยังไม่มี Master เดิม'}</Typography><Typography variant="body2">บัญชี: {(selected.candidate_data.master_account_last4 as string | undefined) ?? '-'} · ธนาคาร: {(selected.candidate_data.master_bank_name as string | undefined) ?? '-'}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>New Evidence</Typography><Typography variant="body2">ค่าจากต้นฉบับ: {(selected.candidate_data.source_name as string | undefined) ?? '-'}</Typography><Typography variant="body2">OCR อ่านได้: {(selected.candidate_data.ocr_name as string | undefined) ?? (selected.candidate_data.recipient_name as string | undefined) ?? selected.display_name}</Typography><Typography variant="body2">บัญชี/ธนาคาร: {candidateAccount(selected) ?? '-'} · {(selected.candidate_data.bank_name as string | undefined) ?? '-'}</Typography><Typography variant="body2">OCR raw text: {(evidence[selected.id] ?? emptyEvidence()).ocrRawText ?? '-'}</Typography><Typography variant="body2">พบเมื่อ: {dateTime((evidence[selected.id] ?? emptyEvidence()).receivedAt)} · confidence: {(evidence[selected.id] ?? emptyEvidence()).aiConfidence == null ? '-' : `${Math.round((evidence[selected.id] ?? emptyEvidence()).aiConfidence! * 100)}%`}</Typography>{(evidence[selected.id] ?? emptyEvidence()).path && <Button size="small" startIcon={<OpenInNewOutlined />} onClick={() => void openSource(selected)}>เปิดรูป/หลักฐานต้นฉบับ</Button>}</Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Suggested Change / Compare</Typography><Typography variant="body2">ค่าที่แนะนำ: {selected.display_name} · เหตุผล: {(selected.candidate_data.suggestion_reason as string | undefined) ?? 'ชื่อ/เลขท้ายบัญชีจากข้อมูลใหม่'}</Typography><Typography variant="body2">จุดที่น่าผิดพลาด: {mismatchStage(selected, evidence[selected.id] ?? null)}</Typography><Chip size="small" color={isNameMismatch(selected, evidence[selected.id] ?? null) ? 'error' : 'success'} label={isNameMismatch(selected, evidence[selected.id] ?? null) ? 'ค่าแตกต่าง ต้องตรวจ' : 'ค่าอ่านตรงกับข้อเสนอ'} /></Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Classification Gate</Typography><Typography variant="body2">ประเภท: {classificationLabel[classifications[selected.id].type]} · {Math.round(classifications[selected.id].confidence * 100)}%</Typography><Typography variant="body2">หลักฐาน: {classifications[selected.id].evidence.join(', ') || 'ยังไม่มีหลักฐานอิสระ'}</Typography><Typography variant="body2">เหตุผล: {classifications[selected.id].reason}</Typography><Typography variant="body2" color={classifications[selected.id].conflicts.length ? 'error' : 'success.main'}>Conflict: {classifications[selected.id].conflicts.join(', ') || 'ไม่พบ'}</Typography><Chip size="small" color={classifications[selected.id].autoVerified ? 'success' : 'warning'} label={classifications[selected.id].autoVerified ? 'Auto Verified · ยังไม่ Final/Locked' : 'ต้องผ่าน Review Gate'} /></Paper><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800 }}>Source Reference / Evidence history</Typography><Typography variant="body2">Document ID: {(evidence[selected.id] ?? emptyEvidence()).documentId ?? '-'} · Intake ID: {(evidence[selected.id] ?? emptyEvidence()).intakeId ?? '-'}</Typography><Typography variant="body2">Room/Channel: {(evidence[selected.id] ?? emptyEvidence()).sourceRoom ?? '-'} / {(evidence[selected.id] ?? emptyEvidence()).sourceChannel ?? '-'} · Message ID: {(evidence[selected.id] ?? emptyEvidence()).messageId ?? '-'}</Typography><Typography variant="body2">Attachment: {(evidence[selected.id] ?? emptyEvidence()).fileName ?? (evidence[selected.id] ?? emptyEvidence()).attachmentId ?? '-'} · Audit: {(evidence[selected.id] ?? emptyEvidence()).auditId ?? '-'}</Typography><Typography variant="body2">กลุ่มนี้พบ {duplicateGroups.find((group) => group.candidateIds.includes(selected.id))?.candidateIds.length ?? 1} source · ล่าสุด {dateTime((evidence[selected.id] ?? emptyEvidence()).receivedAt)}</Typography></Paper><MasterDataProjectGatePanel key={selected.id} candidate={selected} source={evidence[selected.id] ?? emptyEvidence()} projects={projects} saving={savingId === selected.id} reason={reviewReason} message={drawerMessage} onAction={saveProjectGate} onOpenSource={() => void openSource(selected)} /><Paper variant="outlined" sx={{ p: 1.25 }}><Typography sx={{ fontWeight: 800, mb: 1 }}>Admin Correction · Derived data เท่านั้น</Typography><Stack spacing={1}><TextField size="small" label="ชื่อที่แก้ไข" value={correction.display_name} onChange={(event) => setCorrection((current) => ({ ...current, display_name: event.target.value }))} /><Select size="small" value={correction.classification_type} onChange={(event) => setCorrection((current) => ({ ...current, classification_type: event.target.value as MasterClassificationType }))}>{Object.entries(classificationLabel).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</Select><TextField size="small" label="เลขท้ายบัญชี" value={correction.account_last4} onChange={(event) => setCorrection((current) => ({ ...current, account_last4: event.target.value }))} /><TextField size="small" label="ธนาคาร" value={correction.bank_name} onChange={(event) => setCorrection((current) => ({ ...current, bank_name: event.target.value }))} /><TextField size="small" label="เลขภาษี" value={correction.tax_id} onChange={(event) => setCorrection((current) => ({ ...current, tax_id: event.target.value }))} /></Stack><Typography variant="caption" color="text.secondary">Raw/OCR ไม่ถูกเขียนทับ; ระบบ append before/after, actor, เวลา, reason และ Source ลง Audit/Version</Typography></Paper><Divider /><Typography variant="body2">สถานะข้อเสนอ: {candidateStatus[selected.status] ?? selected.status}. ทุก action ส่งเข้า RPC เพื่อ append old/new, actor, time, source และ decision; ไม่มี auto-update จาก evidence ใหม่</Typography></Stack>}</DialogContent>{selected && <MasterDataReviewActions candidate={selected} reason={reviewReason} saving={savingId === selected.id} hasNext={summaryRows.length > 1} onCorrect={() => void correctCandidate()} onReview={(action) => void review(selected, action)} onNext={openNextCandidate} onClose={() => { setSelected(null); setSourceUrl(''); setReviewReason(''); setDrawerMessage(null) }} />}</Drawer>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ alignItems: { md: 'center' } }}><Typography variant="h6" sx={{ flex: 1 }}>Confirmed Data Reports</Typography><Select size="small" value={reportType} onChange={(event) => setReportType(event.target.value as MasterClassificationType | 'all')}><MenuItem value="all">ทุกประเภท</MenuItem>{Object.entries(classificationLabel).filter(([key]) => key !== 'unknown_review').map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}</Select><TextField size="small" type="date" label="วันที่ยืนยัน" value={reportDate} onChange={(event) => setReportDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><Chip label={`${confirmedVisibleCount} รายการ`} /></Stack>
    <StandardDataTable rows={confirmedRows} onFilteredRowCountChange={setConfirmedVisibleCount} getRowId={(row) => row.id} onRowClick={openCandidate} getSearchText={(row) => `${row.display_name} ${candidateAccount(row) ?? ''} ${classificationLabel[classifications[row.id].type]} ${reviewerNames[row.reviewed_by ?? ''] ?? row.reviewed_by ?? ''} ${evidence[row.id]?.messageId ?? ''} ${evidence[row.id]?.sourceRoom ?? ''}`} searchLabel="ค้นหาชื่อ บัญชี ประเภท ผู้ยืนยัน หรือ Source" emptyText="ยังไม่มีข้อมูลยืนยันตามตัวกรอง" minWidth={1120} columns={[
      { id: 'report_type', label: 'ประเภท', minWidth: 190, render: (row) => classificationLabel[classifications[row.id].type] },
      { id: 'report_name', label: 'ชื่อ', minWidth: 220, render: (row) => row.display_name },
      { id: 'report_account', label: 'บัญชี', minWidth: 150, render: (row) => candidateAccount(row) ? `•••• ${candidateAccount(row)}` : '-' },
      { id: 'report_source', label: 'Source', minWidth: 260, render: (row) => `${evidence[row.id]?.sourceRoom ?? '-'} · ${evidence[row.id]?.messageId ?? '-'}` },
      { id: 'report_reviewer', label: 'ผู้ยืนยัน', minWidth: 180, render: (row) => reviewerNames[row.reviewed_by ?? ''] ?? row.reviewed_by ?? '-' },
      { id: 'report_date', label: 'วันที่ยืนยัน', minWidth: 180, render: (row) => dateTime(row.reviewed_at ?? null) },
      { id: 'report_status', label: 'สถานะ', minWidth: 150, render: (row) => candidateStatus[row.status] ?? row.status },
    ]} />
    <Typography variant="h6">บัญชีที่ยืนยันแล้ว</Typography>
    <StandardDataTable rows={accounts} getRowId={(row) => row.id} getSearchText={(row) => `${row.owner_name} ${row.bank_name ?? ''} ${row.account_last4}`} searchLabel="ค้นหาชื่อ ธนาคาร หรือเลขท้ายบัญชี" emptyText="ยังไม่มีบัญชีที่ยืนยัน" minWidth={760} columns={[
      { id: 'owner', label: 'เจ้าของบัญชี', minWidth: 240, render: (row) => row.owner_name },
      { id: 'type', label: 'ประเภทเจ้าของ', minWidth: 140, render: (row) => entityLabel[row.owner_type] ?? row.owner_type },
      { id: 'account', label: 'ธนาคาร / บัญชี', minWidth: 220, render: (row) => `${row.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• ${row.account_last4}` },
      { id: 'state', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.verification_status === 'verified' ? 'success' : 'default'} label={accountStatus[row.verification_status] ?? row.verification_status} /> },
      { id: 'verified', label: 'ยืนยันเมื่อ', minWidth: 180, render: (row) => dateTime(row.verified_at) },
    ]} />
  </Stack>
}

function Metric({ label, value }: { label: string; value: string }) { return <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">{label}</Typography><Typography variant="h6">{value}</Typography></Paper> }
