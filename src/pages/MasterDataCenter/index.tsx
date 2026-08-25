import { CompareArrowsOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { autoInputAuditPayload, buildMasterAutoCorrection, masterAutoRoute } from '../../services/masterDataAutoInput'
import { classificationLabel, classifyMasterCandidate, type MasterClassificationType } from '../../services/masterDataClassification'
import { emptyMasterSourceEvidence, loadMasterSourceEvidence } from '../../services/masterDataSourceGateway'
import { applyLocalProjectGate, isProjectGateReady, projectGateStatus, type MasterProjectOption, type MasterWorkPackageOption } from '../../services/masterDataProjectGate'
import { createMasterDataProjectGateFixture } from '../../services/masterDataProjectGateFixture'
import { loadMasterDataReviewReceipts } from '../../services/masterDataReviewReceipts'
import { buildMasterReviewProjection, localReviewReceipt, validatePersistedCorrection, validatePersistedProjectGate, validatePersistedReviewAction, type MasterReviewAction, type MasterReviewReceipt } from '../../services/masterDataReviewWorkflow'
import { userError } from '../../utils/userError'
import { type ProjectGateAction } from './MasterDataProjectGatePanel'
import { MasterDataReviewDrawer } from './MasterDataReviewDrawer'
import { candidateAccount, groupDuplicateCandidates, isNameMismatch, masterDataRequiresCorrection, mismatchStage, normalizeAccountLast4, reviewFilterMatches, type MasterCandidate, type MasterReviewFilter, type MasterSourceEvidence } from './masterDataReview'

type Candidate = MasterCandidate & { archive_after: string }
type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string; verification_status: string; verified_at: string | null; created_at: string }
type DrawerMessage = { severity: 'success' | 'error' | 'info'; text: string; incidentId?: string; persisted?: boolean }

const candidateStatus: Record<string, string> = { provisional: 'รับเข้า', auto_verified: 'Auto Verified', admin_reviewed: 'Admin แก้แล้ว/รอตรวจซ้ำ', needs_review: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', locked: 'Locked', pending_review: 'รอตรวจสอบ', approved: 'ยืนยันแล้ว', rejected: 'ยกเลิก', archived: 'เก็บถาวร', needs_more_info: 'รอข้อมูลเพิ่ม' }
const accountStatus: Record<string, string> = { verified: 'ยืนยันแล้ว', unverified: 'รอตรวจ', inactive: 'ปิดใช้งาน', archived: 'เก็บถาวร' }
const entityLabel: Record<string, string> = { employee: 'พนักงาน', vendor: 'ผู้ขาย', customer: 'ลูกค้า', project: 'โครงการ', work_package: 'งานย่อย', bank_account: 'บัญชีธนาคาร' }
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : '-'
const emptyEvidence = emptyMasterSourceEvidence
const masterReviewError = (error: unknown) => {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error ?? '')
  const generic = userError(error)
  if (message.includes('master_candidate_account_last4_invalid') || message.includes('master_bank_accounts_account_last4_check')) {
    return 'ยืนยันไม่ได้: เลขบัญชีจากหลักฐานต้องมีอย่างน้อย 4 หลัก ระบบจะเก็บใน Master Data เฉพาะ 4 ตัวท้าย กรุณาตรวจช่องเลขท้ายบัญชีแล้วบันทึก Correction อีกครั้ง'
  }
  return generic
}

export function MasterDataCenterPage() {
  usePageTitle('ศูนย์ข้อมูลกลาง')
  const { currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const localTestData = new URLSearchParams(window.location.search).get('local_test_data') === '1'
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [evidence, setEvidence] = useState<Record<string, MasterSourceEvidence>>({})
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [projects, setProjects] = useState<MasterProjectOption[]>([])
  const [workPackages, setWorkPackages] = useState<MasterWorkPackageOption[]>([])
  const [reviewReceipts, setReviewReceipts] = useState<Record<string, MasterReviewReceipt>>({})
  const [error, setError] = useState('')
  const [drawerMessage, setDrawerMessage] = useState<DrawerMessage | null>(null)
  const [savingId, setSavingId] = useState('')
  const reviewActionInFlightRef = useRef(new Set<string>())
  const [filter, setFilter] = useState<MasterReviewFilter>('pending_review')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [drawerTab, setDrawerTab] = useState(0)
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
      setWorkPackages(fixture.workPackages)
      setAccounts([])
      setReviewerNames({})
      setReviewReceipts(Object.fromEntries(fixture.candidates.map((candidate) => [candidate.id, localReviewReceipt(candidate)])))
      setError('')
      return fixture.candidates as Candidate[]
    }
    if (!companyId) return [] as Candidate[]
    const [candidateResult, accountResult, projectResult, workPackageResult] = await Promise.all([
      supabase.from('master_data_candidates').select('id,entity_type,display_name,normalized_name,candidate_data,confidence,status,source_table,source_id,duplicate_of,review_reason,reviewed_by,reviewed_at,classification_type,classification_confidence,classification_evidence,classification_conflicts,classification_version,classified_at,created_at,archive_after').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4,verification_status,verified_at,created_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
      supabase.from('projects').select('id,name,code,status,project_name,developer_name,province,location_detail,property_type').eq('company_id', companyId).eq('status', 'active').order('name'),
      supabase.from('project_work_packages').select('id,project_id,parent_id,code,name,description,status').eq('company_id', companyId).eq('status', 'active').order('name'),
    ])
    const loadError = candidateResult.error ?? accountResult.error ?? projectResult.error ?? workPackageResult.error
    if (loadError) { setError(userError(loadError)); return [] as Candidate[] }
    const rows = (candidateResult.data ?? []) as Candidate[]
    setCandidates(rows)
    setAccounts((accountResult.data ?? []) as BankAccount[])
    setProjects((projectResult.data ?? []) as MasterProjectOption[])
    setWorkPackages((workPackageResult.data ?? []) as MasterWorkPackageOption[])
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
    return rows
  }, [companyId, localTestData])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const review = async (candidate: Candidate, action: MasterReviewAction) => {
    if (reviewActionInFlightRef.current.has(candidate.id)) {
      setDrawerMessage({ severity: 'info', text: 'กำลังบันทึกรายการนี้ กรุณารอผลยืนยันจากฐานข้อมูลก่อน' })
      return
    }
    if (['confirmed', 'approved', 'locked'].includes(candidate.status)) {
      setDrawerMessage({ severity: 'success', persisted: true, text: 'รายการนี้ยืนยันและบันทึกแล้ว ระบบปิดการยืนยันซ้ำ กรุณาไป “รายการถัดไป”' })
      return
    }
    if (reviewReason.trim().length < 3 && action !== 'archive') { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษรใน Drawer' }); return }
    if (['approve', 'keep_existing', 'match_master', 'lock'].includes(action) && !isProjectGateReady(candidate)) { setDrawerMessage({ severity: 'error', text: 'ต้องผูก Project เดิมหรือบันทึก Project Candidate ให้ครบก่อนยืนยันรายการ' }); return }
    const source = evidence[candidate.id] ?? emptyEvidence()
    const classification = classifyMasterCandidate(candidate, source, duplicateIds.has(candidate.id))
    if (action === 'approve' && masterDataRequiresCorrection(candidate, source, classification.conflicts, classification.type) && candidate.status !== 'admin_reviewed') { setDrawerMessage({ severity: 'error', text: 'พบข้อมูลขาดหรือขัดแย้ง ต้องบันทึกข้อมูลที่แก้และส่งตรวจซ้ำก่อนยืนยัน' }); return }
    if (localTestData) {
      const status = action === 'approve' || action === 'keep_existing' || action === 'match_master' ? 'confirmed' : action === 'reject' ? 'rejected' : action === 'archive' ? 'archived' : action === 'lock' ? 'locked' : action === 'request_info' ? 'needs_more_info' : 'needs_review'
      const updated = { ...candidate, status, review_reason: reviewReason.trim() || null, reviewed_at: new Date().toISOString(), candidate_data: { ...candidate.candidate_data, ...(status === 'confirmed' || status === 'locked' ? { project_gate_resolution: projectGateStatus(candidate), project_gate_status: 'confirmed' } : {}), local_review_action: action } }
      const nextRows = candidates.map((row) => row.id === updated.id ? updated : row)
      setCandidates(nextRows)
      setSelected(updated)
      setReviewReceipts((current) => ({ ...current, [updated.id]: localReviewReceipt(updated) }))
      setReviewReason('')
      setDrawerMessage({ severity: 'success', text: ['confirmed', 'locked', 'rejected', 'archived'].includes(status) ? `Local fixture: ${candidateStatus[status] ?? status} แล้ว · คิวและตัวเลขรีเฟรชแล้ว` : `Local fixture: ${candidateStatus[status] ?? status} แล้ว · รายการยังอยู่คิวและยังไม่ยืนยัน Master Data` })
      return
    }
    reviewActionInFlightRef.current.add(candidate.id)
    setSavingId(candidate.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    try {
      const { data: reviewedData, error: rpcError } = await supabase.rpc('review_master_data_candidate', { target_candidate_id: candidate.id, target_event_key: eventKey, target_action: action, target_reason: reviewReason.trim() || null })
      if (rpcError) { setDrawerMessage({ severity: 'error', text: masterReviewError(rpcError), incidentId: eventKey, persisted: false }); return }
      const reviewed = reviewedData && typeof reviewedData === 'object' ? reviewedData as Candidate : null
      const refreshedRows = await load()
      const persisted = refreshedRows.find((row) => row.id === candidate.id) ?? null
      const persistenceError = validatePersistedReviewAction(candidate.id, action, reviewed, persisted)
      if (persistenceError || !persisted) { setDrawerMessage({ severity: 'error', text: persistenceError ?? 'ตรวจสอบสถานะหลังบันทึกไม่สำเร็จ', incidentId: eventKey, persisted: false }); return }
      setSelected(persisted)
      setReviewReason('')
      const terminal = ['confirmed', 'approved', 'locked', 'rejected', 'archived'].includes(persisted.status)
      setDrawerMessage({
        severity: 'success',
        persisted: true,
        text: terminal
          ? `${candidateStatus[persisted.status] ?? persisted.status} ในฐานข้อมูลแล้ว · คิวและตัวเลขรีเฟรชแล้ว`
          : `${candidateStatus[persisted.status] ?? persisted.status} ในฐานข้อมูลแล้ว · รายการยังไม่ยืนยัน Master Data และยังอยู่คิว`,
      })
    } catch (actionError) {
      setDrawerMessage({ severity: 'error', text: userError(actionError, 'ตรวจสอบการบันทึก Action ไม่สำเร็จ'), incidentId: eventKey, persisted: false })
    } finally {
      reviewActionInFlightRef.current.delete(candidate.id)
      setSavingId('')
    }
  }
  const openSource = async (candidate: Candidate) => {
    const source = evidence[candidate.id] ?? emptyEvidence()
    if (!source.bucket || !source.path) { setDrawerMessage({ severity: 'error', text: 'ไม่พบไฟล์ต้นฉบับของรายการนี้ กรุณาใช้ Document/Message ID ใน Source Reference ตรวจต้นทาง' }); return }
    const signed = await documentFlowGateway.signedPreviewUrl(source.bucket, source.path)
    if (signed.error || !signed.data?.signedUrl) { setDrawerMessage({ severity: 'error', text: `เปิดไฟล์ต้นฉบับไม่สำเร็จ: ${userError(signed.error)}` }); return }
    window.open(signed.data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const openCandidate = (candidate: Candidate) => {
    const source = evidence[candidate.id] ?? emptyEvidence()
    const classification = classifyMasterCandidate(candidate, source, duplicateIds.has(candidate.id))
    const auto = buildMasterAutoCorrection(candidate, source, classification)
    setSelected(candidate)
    setDrawerTab(0)
    setReviewReason('')
    setDrawerMessage(null)
    setCorrection({ display_name: auto.display_name.value, classification_type: auto.classification_type.value, account_last4: auto.account_last4.value, bank_name: auto.bank_name.value, tax_id: auto.tax_id.value })
  }
  const correctCandidate = async () => {
    if (!selected || reviewReason.trim().length < 3) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษรใน Drawer' }); return }
    if (selected.entity_type === 'bank_account' && !normalizeAccountLast4(correction.account_last4)) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเลขบัญชีอย่างน้อย 4 หลัก ระบบจะบันทึกเฉพาะ 4 ตัวท้ายใน Master Data' }); return }
    const selectedSource = evidence[selected.id] ?? emptyEvidence()
    const selectedClassification = classifyMasterCandidate(selected, selectedSource, duplicateIds.has(selected.id))
    const selectedAuto = buildMasterAutoCorrection(selected, selectedSource, selectedClassification)
    const selectedRoute = masterAutoRoute(correction.classification_type, selectedClassification.confidence, selectedClassification.conflicts)
    const correctionPayload = {
      ...correction,
      auto_fill_evidence: autoInputAuditPayload(selectedAuto, selectedRoute),
      suggested_destination: selectedRoute.destination,
      suggested_owner: selectedRoute.owner,
      suggested_next_action: selectedRoute.nextAction,
    }
    if (localTestData) {
      const now = new Date().toISOString()
      const eventKey = `local-correction-${selected.id}-${Date.parse(now)}`
      const afterData = { ...selected, display_name: correction.display_name.trim() || selected.display_name, classification_type: correction.classification_type, status: 'admin_reviewed', review_reason: reviewReason.trim(), reviewed_at: now }
      const updated = { ...afterData, candidate_data: { ...selected.candidate_data, ...correctionPayload, admin_corrected_at: now, admin_corrected_by: 'local-admin', local_correction_version: Number(selected.candidate_data.local_correction_version ?? 0) + 1, local_correction_audit: [...(Array.isArray(selected.candidate_data.local_correction_audit) ? selected.candidate_data.local_correction_audit : []), { event_key: eventKey, actor_id: 'local-admin', at: now, before: selected, after: afterData }] } }
      setSelected(updated); setCandidates((current) => current.map((row) => row.id === updated.id ? updated : row)); setReviewReceipts((current) => ({ ...current, [updated.id]: localReviewReceipt(updated) })); setDrawerMessage({ severity: 'success', text: 'Local fixture: append ฉบับแก้ไข/Version/Audit แล้ว รายการเปลี่ยนเป็นรอตรวจซ้ำ' }); return
    }
    setSavingId(selected.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    try {
      const { data: correctedData, error: correctionError } = await supabase.rpc('correct_master_data_candidate_v2', { target_candidate_id: selected.id, target_event_key: eventKey, target_correction: correctionPayload, target_reason: reviewReason.trim() })
      if (correctionError) { setDrawerMessage({ severity: 'error', text: masterReviewError(correctionError), incidentId: eventKey, persisted: false }); return }
      const corrected = correctedData && typeof correctedData === 'object' ? correctedData as Candidate : null
      const refreshedRows = await load()
      const persisted = refreshedRows.find((row) => row.id === selected.id) ?? null
      const persistenceError = validatePersistedCorrection(selected.id, corrected, persisted)
      if (persistenceError || !persisted) { setDrawerMessage({ severity: 'error', text: persistenceError ?? 'ตรวจสอบ Correction หลังบันทึกไม่สำเร็จ', incidentId: eventKey, persisted: false }); return }
      setSelected(persisted)
      setReviewReason('')
      setDrawerMessage({ severity: 'success', text: 'บันทึก Correction/Version/Audit ในฐานข้อมูลแล้ว · รายการอยู่รอตรวจซ้ำและยังไม่ยืนยัน Master Data', incidentId: eventKey, persisted: true })
    } catch (actionError) {
      setDrawerMessage({ severity: 'error', text: userError(actionError, 'ตรวจสอบ Correction ไม่สำเร็จ'), incidentId: eventKey, persisted: false })
    } finally {
      setSavingId('')
    }
  }
  const createWorkPackage = async (input: { projectId: string; parentId: string | null; name: string; description: string }) => {
    if (localTestData) {
      const created: MasterWorkPackageOption = { id: `local-work-package-${crypto.randomUUID()}`, project_id: input.projectId, parent_id: input.parentId, code: null, name: input.name, description: input.description || null, status: 'active' }
      setWorkPackages((current) => [...current, created])
      setDrawerMessage({ severity: 'success', persisted: true, text: 'Local fixture: เพิ่มเนื้องานแล้วและเลือกใช้งานต่อได้' })
      return created
    }
    if (!selected) return null
    setSavingId(selected.id); setDrawerMessage(null)
    try {
      const result = await documentFlowGateway.createProjectWorkPackage(input)
      if (result.error || !result.data) { setDrawerMessage({ severity: 'error', text: userError(result.error, 'เพิ่มเนื้องานไม่สำเร็จ'), persisted: false }); return null }
      const created = result.data as MasterWorkPackageOption
      setWorkPackages((current) => [...current.filter((item) => item.id !== created.id), created])
      setDrawerMessage({ severity: 'success', persisted: true, text: `บันทึกเนื้องาน “${created.name}” แล้ว · ยังไม่ผูกกับรายการจนกดผูก Project และเนื้องาน` })
      return created
    } finally {
      setSavingId('')
    }
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
    try {
      const { data, error: gateError } = await supabase.rpc('save_master_data_project_gate_v3', { target_candidate_id: selected.id, target_event_key: eventKey, target_action: action, target_payload: payload, target_reason: reviewReason.trim() })
      if (gateError) { setDrawerMessage({ severity: 'error', text: userError(gateError), incidentId: eventKey, persisted: false }); return }
      const result = data && typeof data === 'object' ? data as { candidate?: Candidate } : null
      const rpcCandidate = result?.candidate ?? null
      const refreshedRows = await load()
      const persisted = refreshedRows.find((row) => row.id === selected.id) ?? null
      const persistenceError = validatePersistedProjectGate(selected.id, action, rpcCandidate, persisted)
      if (persistenceError || !persisted) { setDrawerMessage({ severity: 'error', text: persistenceError ?? 'ตรวจสอบ Project Gate หลังบันทึกไม่สำเร็จ', incidentId: eventKey, persisted: false }); return }
      setSelected(persisted)
      setReviewReason('')
      setDrawerMessage({
        severity: 'success',
        persisted: true,
        incidentId: eventKey,
        text: action === 'link_existing_project'
          ? 'ผูก Project และเนื้องานในฐานข้อมูลแล้ว · ตรวจข้อมูลที่ขาด/ขัดแย้งก่อนยืนยัน'
          : action === 'save_project_candidate'
            ? 'บันทึก Project Candidate ในฐานข้อมูลแล้ว · ยังไม่ได้สร้าง Project จริงหรือยืนยัน Master Data'
            : action === 'request_information'
              ? 'บันทึกรอข้อมูลเพิ่มแล้ว · รายการยังอยู่คิวและยังไม่ยืนยัน Master Data'
              : 'บันทึกส่งกลับคิวตรวจแล้ว · รายการยังไม่ยืนยัน Master Data',
      })
    } catch (actionError) {
      setDrawerMessage({ severity: 'error', text: userError(actionError, 'ตรวจสอบ Project Gate ไม่สำเร็จ'), incidentId: eventKey, persisted: false })
    } finally {
      setSavingId('')
    }
  }
  const reviewProjection = useMemo(() => buildMasterReviewProjection(candidates), [candidates])
  const duplicateState = useMemo(() => {
    const groups = groupDuplicateCandidates(candidates)
    return { groups, ids: new Set(groups.flatMap((group) => group.candidateIds)) }
  }, [candidates])
  const duplicateGroups = duplicateState.groups
  const duplicateIds = duplicateState.ids
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
  const conflictCount = reviewProjection.active.filter((candidate) => classifications[candidate.id].conflicts.length > 0).length
  const selectedSource = selected ? evidence[selected.id] ?? emptyEvidence() : emptyEvidence()
  const selectedClassification = selected ? classifications[selected.id] ?? classifyMasterCandidate(selected, selectedSource, duplicateIds.has(selected.id)) : null
  const selectedRequiresCorrection = selected && selectedClassification ? masterDataRequiresCorrection(selected, selectedSource, selectedClassification.conflicts, selectedClassification.type) : false
  const selectedRoute = selectedClassification ? masterAutoRoute(correction.classification_type, selectedClassification.confidence, selectedClassification.conflicts) : null
  const selectedSourceCount = selected ? duplicateGroups.find((group) => group.candidateIds.includes(selected.id))?.candidateIds.length ?? 1 : 0
  const closeDrawer = () => { setSelected(null); setSourceUrl(''); setReviewReason(''); setDrawerMessage(null); setDrawerTab(0) }

  return <Stack spacing={2}>
    <PageHeader title="ศูนย์ข้อมูลกลาง" description="ข้อมูลจากสลิปและเอกสารจะเข้ารอตรวจ ก่อนยืนยันเป็นข้อมูลใช้ร่วมกันทุก Module · ไม่มีการลบข้อมูลที่มีการอ้างอิง" action={<Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button>} />
    {localTestData && <Alert severity="info">LOCAL TEST DATA · master-data-project-first-v1 · 53 รายการ · ไม่มีการอ่านหรือเขียน Production</Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Metric label="คิวที่ต้องจัดการ" value={`${reviewProjection.active.length} รายการ`} /><Metric label="ข้อมูลใหม่" value={`${reviewProjection.incoming.length} รายการ`} /><Metric label="รอตรวจ/รอข้อมูล" value={`${reviewProjection.followUp.length} รายการ`} /><Metric label="Auto Verified" value={`${reviewProjection.autoVerified.length} รายการ`} /><Metric label="ขัดแย้ง" value={`${conflictCount} รายการ`} /><Metric label="ยืนยันแล้ว" value={`${reviewProjection.confirmed.length} รายการ`} /><Metric label="แก้ไขโดย Admin" value={`${reviewProjection.adminReviewed.length} รายการ`} /></Stack>
    <Alert severity="info">สูตรคิวเดียวกัน: คิวที่ต้องจัดการ = ข้อมูลใหม่ + รอตรวจ/รอข้อมูล + Auto Verified + แก้ไขโดย Admin · ตารางและตัวกรอง “รอตรวจ” ใช้ชุดสถานะเดียวกัน</Alert>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">มุมมองนี้สรุปข้อมูลใหม่เป็นกลุ่ม ไม่แสดง OCR ซ้ำเป็นหลายแถว ระบบไม่ auto-merge และการยืนยัน/ปฏิเสธยังบันทึก before/after, actor, เวลา และ source ลง Audit</Typography></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}><Typography variant="h6" sx={{ flex: 1 }}>Review Queue</Typography><Select size="small" value={filter} onChange={(event) => setFilter(event.target.value as MasterReviewFilter)}><MenuItem value="pending_review">รอตรวจ</MenuItem><MenuItem value="duplicate">ซ้ำ</MenuItem><MenuItem value="name_mismatch">ชื่อไม่ตรง</MenuItem><MenuItem value="account_name_mismatch">บัญชีตรงแต่ชื่อไม่ตรง</MenuItem><MenuItem value="conflict">ข้อมูลขัดแย้ง</MenuItem><MenuItem value="unknown_review">Unknown/Needs Review</MenuItem><MenuItem value="all">ทั้งหมด</MenuItem></Select><Chip label={`${reviewVisibleCount} กลุ่ม/รายการ`} /></Stack>
    <StandardDataTable rows={summaryRows} onFilteredRowCountChange={setReviewVisibleCount} getRowId={(row) => row.id} onRowClick={openCandidate} getSearchText={(row) => `${row.display_name} ${entityLabel[row.entity_type] ?? row.entity_type} ${classificationLabel[classifications[row.id].type]} ${candidateAccount(row) ?? ''} ${row.source_id ?? ''} ${evidence[row.id]?.messageId ?? ''}`} searchLabel="ค้นหาชื่อ บัญชี ประเภท Source ID หรือ Message ID" emptyText="ยังไม่มีข้อมูลตามตัวกรอง" minWidth={1460} columns={[
      { id: 'type', label: 'ประเภท', minWidth: 130, render: (row) => entityLabel[row.entity_type] ?? row.entity_type },
      { id: 'classification', label: 'Auto Classification', minWidth: 200, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{classificationLabel[classifications[row.id].type]}</Typography><Typography variant="caption" color="text.secondary">{Math.round(classifications[row.id].confidence * 100)}% · {classifications[row.id].version}</Typography></Stack> },
      { id: 'name', label: 'ข้อมูลใหม่ / ชื่อ', minWidth: 240, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{row.display_name}</Typography>{isNameMismatch(row, evidence[row.id] ?? null) && <Chip size="small" color="error" label={`ผิดที่ ${mismatchStage(row, evidence[row.id] ?? null)}`} />}</Stack> },
      { id: 'bank', label: 'บัญชีจากหลักฐาน', minWidth: 230, render: (row) => row.entity_type === 'bank_account' ? `•••• ${candidateAccount(row) ?? '-'}` : '-' },
      { id: 'duplicate', label: 'Duplicate Group', minWidth: 180, render: (row) => { const group = duplicateGroups.find((item) => item.candidateIds.includes(row.id)); return group ? <Chip size="small" color="warning" label={`${group.candidateIds.length} ต้นทาง`} /> : 'ไม่ซ้ำ' } },
      { id: 'source', label: 'Source Reference', minWidth: 320, render: (row) => { const source = evidence[row.id] ?? emptyEvidence(); return <Stack spacing={0.2}><Typography variant="caption">Document/Intake: {source.documentId ?? source.intakeId ?? 'ไม่พบ mapping'}</Typography><Typography variant="caption">Room: {source.sourceRoom ?? 'ไม่พบห้อง'} · ผู้ส่ง: {source.sourceSender ?? '-'}</Typography><Typography variant="caption">Message: {source.messageId ?? 'ไม่พบ Message ID'} · เข้า: {dateTime(source.receivedAt ?? row.created_at)}</Typography>{!source.sourceResolved && <Chip size="small" color="warning" label="Source ไม่ครบ" />}</Stack> } },
      { id: 'confidence', label: 'ความมั่นใจ AI', minWidth: 130, render: (row) => row.confidence == null ? '-' : `${Math.round(row.confidence * 100)}%` },
      { id: 'created', label: 'พบเมื่อ', minWidth: 170, render: (row) => dateTime(row.created_at) },
      { id: 'status', label: 'สถานะข้อมูล', minWidth: 190, render: (row) => <Chip size="small" color={['confirmed', 'approved', 'auto_verified'].includes(row.status) ? 'success' : row.status === 'locked' ? 'primary' : row.status === 'rejected' ? 'error' : row.status === 'archived' ? 'default' : 'warning'} label={candidateStatus[row.status] ?? row.status} /> },
      { id: 'actions', label: 'ตรวจรายละเอียด', minWidth: 170, render: (row) => <Button size="small" startIcon={<CompareArrowsOutlined />} onClick={(event) => { event.stopPropagation(); openCandidate(row) }}>เปิด Detail</Button> },
    ]} />
    <MasterDataReviewDrawer open={Boolean(selected)} candidate={selected} source={selectedSource} classification={selectedClassification} route={selectedRoute} sourceCount={selectedSourceCount} projects={projects} workPackages={workPackages} receipt={selected ? reviewReceipts[selected.id] ?? { projectCandidate: null, correction: null } : { projectCandidate: null, correction: null }} reviewerName={(id) => id ? reviewerNames[id] ?? id : '-'} correction={correction} reason={reviewReason} saving={Boolean(selected && savingId === selected.id)} message={drawerMessage} activeTab={drawerTab} requiresCorrection={selectedRequiresCorrection} hasNext={summaryRows.length > 1} onTabChange={setDrawerTab} onCorrectionChange={setCorrection} onReasonChange={setReviewReason} onProjectAction={saveProjectGate} onCreateWorkPackage={createWorkPackage} onOpenSource={() => selected && void openSource(selected)} onCorrect={() => void correctCandidate()} onReview={(action) => selected && void review(selected, action)} onNext={openNextCandidate} onClose={closeDrawer} />
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
