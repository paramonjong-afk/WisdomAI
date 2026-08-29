import { CompareArrowsOutlined, RefreshOutlined } from '@mui/icons-material'
import { Alert, Button, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import type { EvidencePreviewState } from '../../components/EvidenceSplitReviewWorkspace'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { advanceFundingRoute, inferMasterRecordingMode, transferPartyDraft, validateAdvanceFundingInput, validatePersistedAdvanceFunding, type AdvanceFundingRpcResult, type MasterRecordingMode, type TransferPartyDraft } from '../../services/masterDataAdvanceFunding'
import { autoInputAuditPayload, buildMasterAutoCorrection, masterAutoRoute } from '../../services/masterDataAutoInput'
import { classificationLabel, classifyMasterCandidate, type MasterClassificationType } from '../../services/masterDataClassification'
import { emptyMasterSourceEvidence, loadMasterSourceEvidence } from '../../services/masterDataSourceGateway'
import { isProjectGateReady, type MasterProjectOption, type MasterWorkPackageOption } from '../../services/masterDataProjectGate'
import { loadMasterDataReviewReceipts } from '../../services/masterDataReviewReceipts'
import { buildMasterReviewProjection, validatePersistedCorrectAndConfirm, validatePersistedCorrection, validatePersistedProjectGate, validatePersistedReviewAction, type MasterReviewAction, type MasterReviewReceipt } from '../../services/masterDataReviewWorkflow'
import { userError } from '../../utils/userError'
import { type ProjectGateAction } from './MasterDataProjectGatePanel'
import { MasterDataReviewDrawer } from './MasterDataReviewDrawer'
import { candidateAccount, groupDuplicateCandidates, isNameMismatch, masterDataRequiresCorrection, mismatchStage, normalizeAccountLast4, reviewFilterMatches, type MasterCandidate, type MasterReviewFilter, type MasterSourceEvidence } from './masterDataReview'

type Candidate = MasterCandidate & { archive_after: string }
type BankAccount = { id: string; owner_name: string; owner_type: string; bank_name: string | null; account_last4: string; verification_status: string; evidence_source_table: string | null; evidence_source_id: string | null; verified_at: string | null; created_at: string }
type PaymentAlias = { id: string; owner_type: string; owner_name: string; alias_type: string; masked_value: string; verification_status: string; evidence_source_table: string | null; evidence_source_id: string | null; verified_by: string | null; verified_at: string | null; version: number; created_at: string; updated_at: string }
type PaymentAliasAudit = { payment_alias_id: string | null; financial_transaction_id: string | null; action: string; reason: string | null; actor_profile_id: string | null; created_at: string }
type DrawerMessage = { severity: 'success' | 'error' | 'info'; text: string; incidentId?: string; persisted?: boolean }

const candidateStatus: Record<string, string> = { provisional: 'รับเข้า', auto_verified: 'Auto Verified', admin_reviewed: 'Admin แก้แล้ว/รอตรวจซ้ำ', needs_review: 'รอตรวจสอบ', confirmed: 'ยืนยันแล้ว', locked: 'Locked', pending_review: 'รอตรวจสอบ', approved: 'ยืนยันแล้ว', rejected: 'ยกเลิก', archived: 'เก็บถาวร', needs_more_info: 'รอข้อมูลเพิ่ม' }
const accountStatus: Record<string, string> = { verified: 'ยืนยันแล้ว', unverified: 'รอตรวจ', conflict: 'ข้อมูลขัดแย้ง', inactive: 'ปิดใช้งาน', archived: 'เก็บถาวร' }
const entityLabel: Record<string, string> = { employee: 'พนักงาน', vendor: 'ผู้ขาย', customer: 'ลูกค้า', company: 'บริษัท', other: 'ยังไม่ทราบเจ้าของ', project: 'โครงการ', work_package: 'งานย่อย', bank_account: 'บัญชีธนาคาร' }
const paymentAliasTypeLabel: Record<string, string> = { mobile: 'เบอร์มือถือ', national_id: 'เลขประชาชน', tax_id: 'เลขภาษี', ewallet_id: 'e-Wallet', unknown_masked: 'เลขปกปิดจากหลักฐาน' }
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
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [evidence, setEvidence] = useState<Record<string, MasterSourceEvidence>>({})
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [paymentAliases, setPaymentAliases] = useState<PaymentAlias[]>([])
  const [paymentAliasAudits, setPaymentAliasAudits] = useState<PaymentAliasAudit[]>([])
  const [projects, setProjects] = useState<MasterProjectOption[]>([])
  const [workPackages, setWorkPackages] = useState<MasterWorkPackageOption[]>([])
  const [reviewReceipts, setReviewReceipts] = useState<Record<string, MasterReviewReceipt>>({})
  const [error, setError] = useState('')
  const [drawerMessage, setDrawerMessage] = useState<DrawerMessage | null>(null)
  const [evidencePreview, setEvidencePreview] = useState<EvidencePreviewState | null>(null)
  const [savingId, setSavingId] = useState('')
  const reviewActionInFlightRef = useRef(new Set<string>())
  const evidencePreviewRequestRef = useRef(0)
  const [filter, setFilter] = useState<MasterReviewFilter>('pending_review')
  const [selected, setSelected] = useState<Candidate | null>(null)
  const [drawerTab, setDrawerTab] = useState(0)
  const [recordingMode, setRecordingMode] = useState<MasterRecordingMode>('project_scoped')
  const [reviewReason, setReviewReason] = useState('')
  const [reviewerNames, setReviewerNames] = useState<Record<string, string>>({})
  const [reportType, setReportType] = useState<MasterClassificationType | 'all'>('all')
  const [reportDate, setReportDate] = useState('')
  const [reviewVisibleCount, setReviewVisibleCount] = useState(0)
  const [confirmedVisibleCount, setConfirmedVisibleCount] = useState(0)
  const [canonicalSyncing, setCanonicalSyncing] = useState(false)
  const [canonicalMessage, setCanonicalMessage] = useState('')
  const [correction, setCorrection] = useState({ display_name: '', classification_type: 'unknown_review' as MasterClassificationType, account_last4: '', bank_name: '', tax_id: '' })
  const [partyDraft, setPartyDraft] = useState<TransferPartyDraft>({ senderName: '', senderAccountLast4: '', senderBankName: '', recipientName: '', recipientAccountLast4: '', recipientBankName: '' })

  const load = useCallback(async () => {
    if (!companyId) return [] as Candidate[]
    const [candidateResult, accountResult, paymentAliasResult, paymentAliasAuditResult, projectResult, workPackageResult] = await Promise.all([
      supabase.from('master_data_candidates').select('id,entity_type,display_name,normalized_name,candidate_data,confidence,status,source_table,source_id,duplicate_of,review_reason,reviewed_by,reviewed_at,classification_type,classification_confidence,classification_evidence,classification_conflicts,classification_version,classified_at,created_at,archive_after').eq('company_id', companyId).order('created_at', { ascending: false }).limit(500),
      supabase.from('master_bank_accounts').select('id,owner_name,owner_type,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_at,created_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
      supabase.from('master_payment_aliases').select('id,owner_type,owner_name,alias_type,masked_value,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,version,created_at,updated_at').eq('company_id', companyId).neq('verification_status', 'archived').order('updated_at', { ascending: false }).limit(500),
      supabase.from('payment_alias_audit').select('payment_alias_id,financial_transaction_id,action,reason,actor_profile_id,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1000),
      supabase.from('projects').select('id,name,code,status,project_name,developer_name,province,location_detail,property_type').eq('company_id', companyId).eq('status', 'active').order('name'),
      supabase.from('project_work_packages').select('id,project_id,parent_id,code,name,description,status').eq('company_id', companyId).eq('status', 'active').order('name'),
    ])
    const loadError = candidateResult.error ?? accountResult.error ?? paymentAliasResult.error ?? paymentAliasAuditResult.error ?? projectResult.error ?? workPackageResult.error
    if (loadError) { setError(userError(loadError)); return [] as Candidate[] }
    const rows = (candidateResult.data ?? []) as Candidate[]
    setCandidates(rows)
    setAccounts((accountResult.data ?? []) as BankAccount[])
    const aliasRows = (paymentAliasResult.data ?? []) as PaymentAlias[]
    const aliasAuditRows = (paymentAliasAuditResult.data ?? []) as PaymentAliasAudit[]
    setPaymentAliases(aliasRows)
    setPaymentAliasAudits(aliasAuditRows)
    setProjects((projectResult.data ?? []) as MasterProjectOption[])
    setWorkPackages((workPackageResult.data ?? []) as MasterWorkPackageOption[])
    const reviewerIds = [...new Set([
      ...rows.map((row) => row.reviewed_by),
      ...aliasRows.map((row) => row.verified_by),
      ...aliasAuditRows.map((row) => row.actor_profile_id),
    ].filter((id): id is string => Boolean(id)))]
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
  }, [companyId])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const syncCanonicalMatches = async () => {
    if (!companyId || canonicalSyncing) return
    setCanonicalSyncing(true); setCanonicalMessage(''); setError('')
    try {
      const { data, error: syncError } = await supabase.rpc('reprocess_master_data_canonical_matches', { target_company_id: companyId, target_limit: 500 })
      if (syncError) { setError(userError(syncError)); return }
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      await load()
      setCanonicalMessage(`ตรวจ ${Number(result.processed ?? 0)} รายการ · เชื่อม Canonical ${Number(result.linked ?? 0)} · ขัดแย้ง ${Number(result.conflict ?? 0)} · ไม่เข้าเกณฑ์ ${Number(result.skipped ?? 0)}`)
    } catch (syncError) {
      setError(userError(syncError, 'ตรวจจับคู่ Canonical ไม่สำเร็จ'))
    } finally {
      setCanonicalSyncing(false)
    }
  }
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
    const requestId = ++evidencePreviewRequestRef.current
    const previewBase = { recordId: candidate.id, fileName: source.fileName ?? `หลักฐาน-${candidate.id.slice(0, 8)}`, contentType: source.attachmentContentType }
    setDrawerMessage(null)
    setEvidencePreview({ ...previewBase, url: null, loading: true, error: null })
    if (!source.bucket || !source.path) {
      if (requestId !== evidencePreviewRequestRef.current) return
      setEvidencePreview({ ...previewBase, url: null, loading: false, error: 'ไม่พบไฟล์ต้นฉบับของรายการนี้ กรุณาใช้ Document/Message ID ใน Source Reference ตรวจต้นทาง' })
      return
    }
    const signed = await documentFlowGateway.signedPreviewUrl(source.bucket, source.path)
    if (requestId !== evidencePreviewRequestRef.current) return
    if (signed.error || !signed.data?.signedUrl) {
      setEvidencePreview({ ...previewBase, url: null, loading: false, error: `เปิดไฟล์ต้นฉบับไม่สำเร็จ: ${userError(signed.error)}` })
      return
    }
    setEvidencePreview({ ...previewBase, url: signed.data.signedUrl, loading: false, error: null })
  }
  const closeEvidencePreview = () => { evidencePreviewRequestRef.current += 1; setEvidencePreview(null) }
  const retryEvidencePreview = () => { if (selected) void openSource(selected) }
  const openEvidenceInNewTab = () => {
    if (!evidencePreview?.url) return
    window.open(evidencePreview.url, '_blank', 'noopener,noreferrer')
  }
  const openCandidate = (candidate: Candidate) => {
    const source = evidence[candidate.id] ?? emptyEvidence()
    const classification = classifyMasterCandidate(candidate, source, duplicateIds.has(candidate.id))
    const auto = buildMasterAutoCorrection(candidate, source, classification)
    setSelected(candidate)
    closeEvidencePreview()
    setDrawerTab(0)
    setRecordingMode(inferMasterRecordingMode(candidate))
    setReviewReason('')
    setDrawerMessage(null)
    setCorrection({ display_name: auto.display_name.value, classification_type: auto.classification_type.value, account_last4: auto.account_last4.value, bank_name: auto.bank_name.value, tax_id: auto.tax_id.value })
    setPartyDraft(transferPartyDraft(candidate, source))
  }
  const changeRecordingMode = (mode: MasterRecordingMode) => {
    setRecordingMode(mode)
    setDrawerMessage(null)
    if (mode === 'employee_advance_funding') {
      setCorrection((current) => ({ ...current, classification_type: 'employee_technician' }))
      if (selected) setPartyDraft(transferPartyDraft(selected, evidence[selected.id] ?? emptyEvidence()))
    }
  }
  const confirmAdvanceFunding = async () => {
    if (!selected) return
    const source = evidence[selected.id] ?? emptyEvidence()
    const input = { ...partyDraft, classificationType: 'employee_technician', reason: reviewReason }
    const validation = validateAdvanceFundingInput(selected, source, input)
    if (!validation.valid) { setDrawerMessage({ severity: 'error', text: `ยังบันทึกเงินทดลองจ่ายไม่ได้: ${validation.blockers.join(' · ')}` }); return }
    if (reviewActionInFlightRef.current.has(selected.id)) { setDrawerMessage({ severity: 'info', text: 'กำลังบันทึกรายการนี้ กรุณารอผลยืนยันจากฐานข้อมูลก่อน' }); return }
    reviewActionInFlightRef.current.add(selected.id)
    setSavingId(selected.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_master_data_employee_advance_funding_v2', {
        target_candidate_id: selected.id,
        target_event_key: eventKey,
        target_reason: reviewReason.trim(),
        target_sender_name: partyDraft.senderName.trim(),
        target_sender_account_last4: normalizeAccountLast4(partyDraft.senderAccountLast4),
        target_sender_bank_name: partyDraft.senderBankName.trim() || null,
        target_recipient_name: partyDraft.recipientName.trim(),
        target_recipient_account_last4: normalizeAccountLast4(partyDraft.recipientAccountLast4),
        target_recipient_bank_name: partyDraft.recipientBankName.trim() || null,
      })
      if (rpcError) { setDrawerMessage({ severity: 'error', text: masterReviewError(rpcError), incidentId: eventKey, persisted: false }); return }
      const result = data && typeof data === 'object' ? data as AdvanceFundingRpcResult : null
      const refreshedRows = await load()
      const persisted = refreshedRows.find((row) => row.id === selected.id) ?? null
      const persistenceError = validatePersistedAdvanceFunding(selected.id, result, persisted)
      if (persistenceError || !persisted) { setDrawerMessage({ severity: 'error', text: persistenceError ?? 'ตรวจสอบเงินทดลองจ่ายหลังบันทึกไม่สำเร็จ', incidentId: eventKey, persisted: false }); return }
      setSelected(persisted)
      setReviewReason('')
      const holderText = result?.holder_match_status?.startsWith('matched_') ? 'จับคู่ผู้ถือเงินเดิมแล้ว' : 'รอบัญชีจับคู่ผู้ถือเงิน'
      setDrawerMessage({ severity: 'success', persisted: true, incidentId: eventKey, text: `ยืนยันผู้โอน Company/Internal และผู้รับ Employee/Technician ครบสองฝั่งแล้ว · ส่ง Accounting Pending Queue แล้ว · ${holderText} · Project รอจัดสรรตอนลงค่าใช้จ่าย` })
    } catch (actionError) {
      setDrawerMessage({ severity: 'error', text: userError(actionError, 'บันทึกเงินทดลองจ่ายไม่สำเร็จ'), incidentId: eventKey, persisted: false })
    } finally {
      reviewActionInFlightRef.current.delete(selected.id)
      setSavingId('')
    }
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
  const correctAndConfirmCandidate = async () => {
    if (!selected || reviewReason.trim().length < 3) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเหตุผลการแก้ไขอย่างน้อย 3 ตัวอักษรใน Drawer' }); return }
    if (!isProjectGateReady(selected)) { setDrawerMessage({ severity: 'error', text: 'ต้องผูก Project เดิมหรือบันทึก Project Candidate ให้ครบก่อนยืนยันรายการ' }); return }
    if (!correction.display_name.trim() || correction.classification_type === 'unknown_review') { setDrawerMessage({ severity: 'error', text: 'ชื่อหรือประเภทข้อมูลยังไม่ครบ ระบบจะยังไม่ยืนยันถาวร' }); return }
    if (selected.entity_type === 'bank_account' && !normalizeAccountLast4(correction.account_last4)) { setDrawerMessage({ severity: 'error', text: 'กรุณาระบุเลขบัญชีอย่างน้อย 4 หลัก ระบบจะบันทึกเฉพาะ 4 ตัวท้ายใน Master Data' }); return }
    if (reviewActionInFlightRef.current.has(selected.id)) { setDrawerMessage({ severity: 'info', text: 'กำลังบันทึกรายการนี้ กรุณารอผลยืนยันจากฐานข้อมูลก่อน' }); return }
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
    reviewActionInFlightRef.current.add(selected.id)
    setSavingId(selected.id); setDrawerMessage(null); setError('')
    const eventKey = crypto.randomUUID()
    try {
      const { data, error: rpcError } = await supabase.rpc('correct_and_confirm_master_data_candidate', { target_candidate_id: selected.id, target_event_key: eventKey, target_correction: correctionPayload, target_reason: reviewReason.trim() })
      if (rpcError) { setDrawerMessage({ severity: 'error', text: masterReviewError(rpcError), incidentId: eventKey, persisted: false }); return }
      const rpcCandidate = data && typeof data === 'object' ? data as Candidate : null
      const refreshedRows = await load()
      const persisted = refreshedRows.find((row) => row.id === selected.id) ?? null
      const persistenceError = validatePersistedCorrectAndConfirm(selected.id, rpcCandidate, persisted)
      if (persistenceError || !persisted) { setDrawerMessage({ severity: 'error', text: persistenceError ?? 'ตรวจสอบข้อมูลกลางหลังบันทึกไม่สำเร็จ', incidentId: eventKey, persisted: false }); return }
      setSelected(persisted)
      setDrawerTab(1)
      setReviewReason('')
      setDrawerMessage({ severity: 'success', text: 'บันทึก Correction + ยืนยัน + Audit สำเร็จ · ค่าที่ Admin แก้เป็นข้อมูลกลางที่ Module ใช้งานทันที', incidentId: eventKey, persisted: true })
    } catch (actionError) {
      setDrawerMessage({ severity: 'error', text: userError(actionError, 'บันทึกและยืนยันข้อมูลไม่สำเร็จ'), incidentId: eventKey, persisted: false })
    } finally {
      reviewActionInFlightRef.current.delete(selected.id)
      setSavingId('')
    }
  }
  const createWorkPackage = async (input: { projectId: string; parentId: string | null; name: string; description: string }) => {
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
  const canonicalLinkedCount = candidates.filter((candidate) => candidate.status === 'archived' && candidate.candidate_data.canonical_match_status === 'linked').length
  const canonicalConflictCount = reviewProjection.active.filter((candidate) => candidate.candidate_data.canonical_match_status === 'conflict').length
  const verifiedPaymentAliasCount = paymentAliases.filter((alias) => alias.verification_status === 'verified').length
  const pendingPaymentAliasCount = paymentAliases.filter((alias) => ['unverified', 'conflict'].includes(alias.verification_status)).length
  const paymentAliasAuditById = useMemo(() => {
    const result = new Map<string, PaymentAliasAudit[]>()
    paymentAliasAudits.forEach((audit) => {
      if (!audit.payment_alias_id) return
      result.set(audit.payment_alias_id, [...(result.get(audit.payment_alias_id) ?? []), audit])
    })
    return result
  }, [paymentAliasAudits])
  const selectedSource = selected ? evidence[selected.id] ?? emptyEvidence() : emptyEvidence()
  const selectedClassification = selected ? classifications[selected.id] ?? classifyMasterCandidate(selected, selectedSource, duplicateIds.has(selected.id)) : null
  const selectedRequiresCorrection = selected && selectedClassification ? masterDataRequiresCorrection(selected, selectedSource, selectedClassification.conflicts, selectedClassification.type) : false
  const selectedCanCorrectAndConfirm = Boolean(selected && selectedRequiresCorrection && isProjectGateReady(selected) && correction.display_name.trim() && correction.classification_type !== 'unknown_review' && (selected.entity_type !== 'bank_account' || normalizeAccountLast4(correction.account_last4)))
  const selectedRoute = selectedClassification ? recordingMode === 'employee_advance_funding' ? { ...advanceFundingRoute, requiresReview: true } : masterAutoRoute(correction.classification_type, selectedClassification.confidence, selectedClassification.conflicts) : null
  const selectedAdvanceValidation = selected ? validateAdvanceFundingInput(selected, selectedSource, { ...partyDraft, classificationType: 'employee_technician', reason: reviewReason }) : { valid: false, blockers: [] }
  const selectedSourceCount = selected ? duplicateGroups.find((group) => group.candidateIds.includes(selected.id))?.candidateIds.length ?? 1 : 0
  const closeDrawer = () => { setSelected(null); closeEvidencePreview(); setReviewReason(''); setDrawerMessage(null); setDrawerTab(0); setRecordingMode('project_scoped') }

  return <Stack spacing={2}>
    <PageHeader title="ศูนย์ข้อมูลกลาง" description="ข้อมูลจากสลิปและเอกสารจะเข้ารอตรวจ ก่อนยืนยันเป็นข้อมูลใช้ร่วมกันทุก Module · ไม่มีการลบข้อมูลที่มีการอ้างอิง" action={<Stack direction="row" spacing={1}><Button variant="outlined" disabled={canonicalSyncing} onClick={() => void syncCanonicalMatches()}>{canonicalSyncing ? 'กำลังจับคู่...' : 'จับคู่ Canonical'}</Button><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button></Stack>} />
    {error && <Alert severity="error">{error}</Alert>}
    {canonicalMessage && <Alert severity="success">{canonicalMessage}</Alert>}
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Metric label="คิวที่ต้องจัดการ" value={`${reviewProjection.active.length} รายการ`} /><Metric label="ข้อมูลใหม่" value={`${reviewProjection.incoming.length} รายการ`} /><Metric label="รอตรวจ/รอข้อมูล" value={`${reviewProjection.followUp.length} รายการ`} /><Metric label="Auto Verified" value={`${reviewProjection.autoVerified.length} รายการ`} /><Metric label="Canonical เชื่อมแล้ว" value={`${canonicalLinkedCount} รายการ`} /><Metric label="Canonical ขัดแย้ง" value={`${canonicalConflictCount} รายการ`} /><Metric label="PromptPay รอตรวจ" value={`${pendingPaymentAliasCount} รายการ`} /><Metric label="PromptPay ยืนยันแล้ว" value={`${verifiedPaymentAliasCount} รายการ`} /><Metric label="ขัดแย้งทั้งหมด" value={`${conflictCount} รายการ`} /><Metric label="ยืนยันแล้ว" value={`${reviewProjection.confirmed.length} รายการ`} /><Metric label="แก้ไขโดย Admin" value={`${reviewProjection.adminReviewed.length} รายการ`} /></Stack>
    <Alert severity="info">สูตรคิวเดียวกัน: คิวที่ต้องจัดการ = ข้อมูลใหม่ + รอตรวจ/รอข้อมูล + Auto Verified + แก้ไขโดย Admin · ตารางและตัวกรอง “รอตรวจ” ใช้ชุดสถานะเดียวกัน</Alert>
    <Paper variant="outlined" sx={{ p: 1.5 }}><Typography variant="body2">ข้อมูลหลักมีชุดเดียวใน “บัญชีที่ยืนยันแล้ว” และใช้ Canonical ID ร่วมกันทุก Module เมื่อสลิปที่ Admin ยืนยันมีชื่อมาตรฐาน + ธนาคารมาตรฐาน + เลขท้ายบัญชีครบ ระบบจะอัปเดต Canonical และนำ Candidate ที่ตรงออกจาก Review Queue อัตโนมัติ พร้อม Version/Audit โดยเก็บ Source, รูปและ OCR เดิมไว้ หากตรงเพียงชื่อหรือพบข้อมูลขัดแย้งจะคงไว้รอตรวจ</Typography></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'center' } }}><Typography variant="h6" sx={{ flex: 1 }}>Review Queue</Typography><Select size="small" value={filter} onChange={(event) => setFilter(event.target.value as MasterReviewFilter)}><MenuItem value="pending_review">รอตรวจ</MenuItem><MenuItem value="duplicate">ซ้ำ</MenuItem><MenuItem value="name_mismatch">ชื่อไม่ตรง</MenuItem><MenuItem value="account_name_mismatch">บัญชีตรงแต่ชื่อไม่ตรง</MenuItem><MenuItem value="conflict">ข้อมูลขัดแย้ง</MenuItem><MenuItem value="unknown_review">Unknown/Needs Review</MenuItem><MenuItem value="all">ทั้งหมด</MenuItem></Select><Chip label={`${reviewVisibleCount} กลุ่ม/รายการ`} /></Stack>
    <StandardDataTable rows={summaryRows} onFilteredRowCountChange={setReviewVisibleCount} getRowId={(row) => row.id} onRowClick={openCandidate} getSearchText={(row) => `${row.display_name} ${entityLabel[row.entity_type] ?? row.entity_type} ${classificationLabel[classifications[row.id].type]} ${candidateAccount(row) ?? ''} ${row.source_id ?? ''} ${evidence[row.id]?.messageId ?? ''}`} searchLabel="ค้นหาชื่อ บัญชี ประเภท Source ID หรือ Message ID" emptyText="ยังไม่มีข้อมูลตามตัวกรอง" minWidth={1460} columns={[
      { id: 'type', label: 'ประเภท', minWidth: 130, render: (row) => entityLabel[row.entity_type] ?? row.entity_type },
      { id: 'classification', label: 'Auto Classification', minWidth: 200, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{classificationLabel[classifications[row.id].type]}</Typography><Typography variant="caption" color="text.secondary">{Math.round(classifications[row.id].confidence * 100)}% · {classifications[row.id].version}</Typography></Stack> },
      { id: 'name', label: 'ข้อมูลใหม่ / ชื่อ', minWidth: 240, render: (row) => <Stack spacing={0.25}><Typography variant="body2">{row.display_name}</Typography>{row.candidate_data.canonical_match_status === 'conflict' && <Chip size="small" color="warning" label="Canonical ซ้ำ/ขัดแย้ง" />}{isNameMismatch(row, evidence[row.id] ?? null) && <Chip size="small" color="error" label={`ผิดที่ ${mismatchStage(row, evidence[row.id] ?? null)}`} />}</Stack> },
      { id: 'bank', label: 'บัญชีจากหลักฐาน', minWidth: 230, render: (row) => row.entity_type === 'bank_account' ? `•••• ${candidateAccount(row) ?? '-'}` : '-' },
      { id: 'duplicate', label: 'Duplicate Group', minWidth: 180, render: (row) => { const group = duplicateGroups.find((item) => item.candidateIds.includes(row.id)); return group ? <Chip size="small" color="warning" label={`${group.candidateIds.length} ต้นทาง`} /> : 'ไม่ซ้ำ' } },
      { id: 'source', label: 'Source Reference', minWidth: 320, render: (row) => { const source = evidence[row.id] ?? emptyEvidence(); return <Stack spacing={0.2}><Typography variant="caption">Document/Intake: {source.documentId ?? source.intakeId ?? 'ไม่พบ mapping'}</Typography><Typography variant="caption">Room: {source.sourceRoom ?? 'ไม่พบห้อง'} · ผู้ส่ง: {source.sourceSender ?? '-'}</Typography><Typography variant="caption">Message: {source.messageId ?? 'ไม่พบ Message ID'} · เข้า: {dateTime(source.receivedAt ?? row.created_at)}</Typography>{!source.sourceResolved && <Chip size="small" color="warning" label="Source ไม่ครบ" />}</Stack> } },
      { id: 'confidence', label: 'ความมั่นใจ AI', minWidth: 130, render: (row) => row.confidence == null ? '-' : `${Math.round(row.confidence * 100)}%` },
      { id: 'created', label: 'พบเมื่อ', minWidth: 170, render: (row) => dateTime(row.created_at) },
      { id: 'status', label: 'สถานะข้อมูล', minWidth: 190, render: (row) => <Chip size="small" color={['confirmed', 'approved', 'auto_verified'].includes(row.status) ? 'success' : row.status === 'locked' ? 'primary' : row.status === 'rejected' ? 'error' : row.status === 'archived' ? 'default' : 'warning'} label={candidateStatus[row.status] ?? row.status} /> },
      { id: 'actions', label: 'ตรวจรายละเอียด', minWidth: 170, render: (row) => <Button size="small" startIcon={<CompareArrowsOutlined />} onClick={(event) => { event.stopPropagation(); openCandidate(row) }}>เปิด Detail</Button> },
    ]} />
    <MasterDataReviewDrawer open={Boolean(selected)} candidate={selected} source={selectedSource} classification={selectedClassification} route={selectedRoute} sourceCount={selectedSourceCount} projects={projects} workPackages={workPackages} receipt={selected ? reviewReceipts[selected.id] ?? { projectCandidate: null, correction: null } : { projectCandidate: null, correction: null }} reviewerName={(id) => id ? reviewerNames[id] ?? id : '-'} correction={correction} partyDraft={partyDraft} reason={reviewReason} saving={Boolean(selected && savingId === selected.id)} message={drawerMessage} activeTab={drawerTab} requiresCorrection={selectedRequiresCorrection} canCorrectAndConfirm={selectedCanCorrectAndConfirm} hasNext={summaryRows.length > 1} preview={evidencePreview} recordingMode={recordingMode} advanceBlockers={selectedAdvanceValidation.blockers} onRecordingModeChange={changeRecordingMode} onConfirmAdvanceFunding={() => void confirmAdvanceFunding()} onTabChange={setDrawerTab} onCorrectionChange={setCorrection} onPartyDraftChange={setPartyDraft} onReasonChange={setReviewReason} onProjectAction={saveProjectGate} onCreateWorkPackage={createWorkPackage} onOpenSource={() => selected && void openSource(selected)} onClosePreview={closeEvidencePreview} onRetryPreview={retryEvidencePreview} onOpenPreviewExternal={openEvidenceInNewTab} onCorrect={() => void correctCandidate()} onCorrectAndConfirm={() => void correctAndConfirmCandidate()} onReview={(action) => selected && void review(selected, action)} onNext={openNextCandidate} onClose={closeDrawer} />
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
    <StandardDataTable rows={accounts} getRowId={(row) => row.id} getSearchText={(row) => `${row.owner_name} ${row.bank_name ?? ''} ${row.account_last4} ${row.id}`} searchLabel="ค้นหาชื่อ ธนาคาร เลขท้ายบัญชี หรือ Canonical ID" emptyText="ยังไม่มีบัญชีที่ยืนยัน" minWidth={1100} columns={[
      { id: 'canonical_id', label: 'Canonical ID', minWidth: 210, render: (row) => <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{row.id}</Typography> },
      { id: 'owner', label: 'เจ้าของบัญชี', minWidth: 240, render: (row) => row.owner_name },
      { id: 'type', label: 'ประเภทเจ้าของ', minWidth: 140, render: (row) => entityLabel[row.owner_type] ?? row.owner_type },
      { id: 'account', label: 'ธนาคาร / บัญชี', minWidth: 220, render: (row) => `${row.bank_name ?? 'ไม่ระบุธนาคาร'} · •••• ${row.account_last4}` },
      { id: 'evidence', label: 'หลักฐานยืนยันล่าสุด', minWidth: 220, render: (row) => row.evidence_source_table === 'transfer_slip_money_lineages' ? 'สลิปที่ Admin ยืนยัน' : row.evidence_source_table ?? '-' },
      { id: 'state', label: 'สถานะ', minWidth: 140, render: (row) => <Chip size="small" color={row.verification_status === 'verified' ? 'success' : 'default'} label={accountStatus[row.verification_status] ?? row.verification_status} /> },
      { id: 'verified', label: 'ยืนยันเมื่อ', minWidth: 180, render: (row) => dateTime(row.verified_at) },
    ]} />
    <Stack spacing={0.5}>
      <Typography variant="h6">PromptPay และช่องทางรับ/จ่าย Canonical</Typography>
      <Typography variant="body2" color="text.secondary">PromptPay เป็น Alias ของพนักงาน ผู้ขาย ลูกค้า หรือบริษัท ไม่ใช่บัญชีธนาคาร รายการเลขปกปิดจะยังรอตรวจจนกว่าจะมีหลักฐานระบุตัวเจ้าของได้แน่นอน</Typography>
    </Stack>
    <StandardDataTable rows={paymentAliases} getRowId={(row) => row.id} getSearchText={(row) => `${row.owner_name} ${entityLabel[row.owner_type] ?? row.owner_type} ${paymentAliasTypeLabel[row.alias_type] ?? row.alias_type} ${row.masked_value} ${row.id} ${row.evidence_source_id ?? ''}`} searchLabel="ค้นหาเจ้าของ ประเภท PromptPay เลขปกปิด Source หรือ Canonical ID" emptyText="ยังไม่มี PromptPay Canonical" minWidth={1420} columns={[
      { id: 'alias_id', label: 'Canonical Alias ID', minWidth: 210, render: (row) => <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{row.id}</Typography> },
      { id: 'alias_owner', label: 'เจ้าของ', minWidth: 230, render: (row) => <Stack spacing={0.2}><Typography variant="body2">{row.owner_name}</Typography><Typography variant="caption" color="text.secondary">{entityLabel[row.owner_type] ?? row.owner_type}</Typography></Stack> },
      { id: 'alias_value', label: 'ประเภท / ค่าแสดง', minWidth: 220, render: (row) => <Stack spacing={0.2}><Typography variant="body2">{paymentAliasTypeLabel[row.alias_type] ?? row.alias_type}</Typography><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{row.masked_value}</Typography></Stack> },
      { id: 'alias_status', label: 'สถานะ', minWidth: 150, render: (row) => <Chip size="small" color={row.verification_status === 'verified' ? 'success' : row.verification_status === 'conflict' ? 'error' : 'warning'} label={accountStatus[row.verification_status] ?? row.verification_status} /> },
      { id: 'alias_source', label: 'Source Reference', minWidth: 270, render: (row) => <Stack spacing={0.2}><Typography variant="caption">{row.evidence_source_table ?? 'ไม่ระบุตาราง'}</Typography><Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{row.evidence_source_id ?? 'ไม่พบ Source ID'}</Typography></Stack> },
      { id: 'alias_audit', label: 'Audit ล่าสุด', minWidth: 260, render: (row) => { const audits = paymentAliasAuditById.get(row.id) ?? []; const latest = audits[0]; return <Stack spacing={0.2}><Typography variant="body2">{latest?.action ?? 'ยังไม่มี Audit'}</Typography><Typography variant="caption" color="text.secondary">{latest?.reason ?? `${audits.length} events`} · {dateTime(latest?.created_at ?? null)}</Typography></Stack> } },
      { id: 'alias_reviewer', label: 'ผู้ยืนยัน / Version', minWidth: 190, render: (row) => <Stack spacing={0.2}><Typography variant="body2">{row.verified_by ? reviewerNames[row.verified_by] ?? row.verified_by : 'ยังไม่ยืนยัน'}</Typography><Typography variant="caption" color="text.secondary">Version {row.version} · {dateTime(row.verified_at)}</Typography></Stack> },
      { id: 'alias_open', label: 'ตรวจหลักฐาน', minWidth: 150, render: (row) => row.evidence_source_table === 'financial_transactions' && row.evidence_source_id ? <Button size="small" component="a" href={`/accounting-documents?transaction_id=${encodeURIComponent(row.evidence_source_id)}`}>เปิดสลิป</Button> : '-' },
    ]} />
  </Stack>
}

function Metric({ label, value }: { label: string; value: string }) { return <Paper variant="outlined" sx={{ p: 1.5, flex: '1 1 150px' }}><Typography variant="caption">{label}</Typography><Typography variant="h6">{value}</Typography></Paper> }
