import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'

type ReviewStatus = 'pending' | 'confirmed' | 'corrected' | 'dismissed' | 'needs_information' | 'forwarded'
type ReviewCase = {
  id: string
  source_message_id: string
  attachment_id: string | null
  proposed_project_id: string | null
  proposed_primary_purpose: string
  proposed_document_type: string | null
  proposed_secondary_purposes: string[]
  proposed_output: Record<string, unknown>
  ai_provider: string
  ai_model: string | null
  ai_confidence: number | null
  responsible_profile_id: string | null
  confirmed_project_id: string | null
  confirmed_primary_purpose: string | null
  confirmed_document_type: string | null
  confirmed_secondary_purposes: string[]
  review_status: ReviewStatus
  review_note: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  created_at: string
}
type Purpose = { code: string; name_th: string; description: string | null }
type DocumentType = { code: string; name_th: string; description: string | null }
type Project = { id: string; name: string; code: string | null }
type Profile = { id: string; full_name: string | null; email: string | null }
type Attachment = { id: string; storage_bucket: string; storage_path: string; content_type: string | null }
type SourceMessage = {
  id: string
  occurred_at: string
  line_senders: { display_name: string | null } | null
  line_groups: { display_name: string | null } | null
}
type LearningSample = {
  id: string; review_case_id: string; ai_provider: string; ai_model: string | null
  purpose_match: boolean; project_match: boolean | null; training_status: string
  document_type_match: boolean | null
  verified_at: string
}
type Scorecard = {
  ai_provider: string; ai_model: string; reviewed_samples: number; correct_purpose: number
  purpose_accuracy: number | null; project_samples: number; project_accuracy: number | null
  document_type_samples: number; document_type_accuracy: number | null
  average_confidence: number | null; last_verified_at: string | null
}
type Observation = {
  id: string; review_case_id: string; provider: string; model: string
  role: 'vision' | 'ocr' | 'classifier' | 'ensemble'
  result: Record<string, unknown>; confidence: number | null
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'unavailable'
  error_message: string | null
}
type Progress = {
  total_received: number; awaiting_review: number; confirmed: number; corrected: number
  dismissed: number; correct_fields: number; corrected_fields: number; missing_fields: number
  average_wisdom_confidence: number | null; last_activity_at: string | null
}
type FieldReview = {
  field_key: string; field_label: string; ai_value: unknown
  verified_value: string; verdict: 'correct' | 'corrected' | 'unreadable' | 'missing' | 'not_applicable'
  confidence: number | null
}

const statusLabels: Record<ReviewStatus, string> = {
  pending: 'รอยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  corrected: 'แก้ไขและยืนยันแล้ว',
  dismissed: 'ไม่นำมาใช้',
  needs_information: 'ขอข้อมูลเพิ่ม',
  forwarded: 'ส่งต่อแล้ว',
}

const displayProfile = (profile?: Profile) => profile?.full_name || profile?.email || 'ยังไม่มอบหมาย'
const percent = (value: number | null) => value == null ? '-' : `${(Number(value) * 100).toFixed(1)}%`
const nestedValue = (source: Record<string, unknown>, path: string) =>
  path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null, source)
const displayValue = (value: unknown) => {
  if (value == null || value === '') return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
const reviewFields = (item: ReviewCase): FieldReview[] => {
  const output = item.proposed_output
  const definitions = [
    ['summary_text', 'สรุปสิ่งที่ AI ตรวจพบ'],
    ['category', 'ลักษณะภาพ/งาน'],
    ['accounting_document.document_type', 'ชนิดเอกสาร'],
    ['accounting_document.document_number', 'เลขที่เอกสาร'],
    ['accounting_document.document_date', 'วันที่เอกสาร'],
    ['accounting_document.vendor_name', 'ร้านค้า/ผู้ขาย'],
    ['accounting_document.vendor_tax_id', 'เลขประจำตัวผู้เสียภาษี'],
    ['accounting_document.subtotal', 'ยอดก่อนภาษี'],
    ['accounting_document.vat_amount', 'ภาษีมูลค่าเพิ่ม'],
    ['accounting_document.total_amount', 'ยอดรวม'],
    ['accounting_document.payment_method', 'วิธีชำระเงิน'],
    ['accounting_document.flow_direction', 'ทิศทางการเงิน'],
    ['accounting_document.lifecycle_stage', 'ขั้นตอนวงจรเอกสาร'],
    ['accounting_document.counterparty_type', 'ประเภทคู่ค้า/คู่สัญญา'],
    ['accounting_document.expense_categories', 'หมวดค่าใช้จ่าย'],
    ['accounting_document.cost_center_code', 'Cost Center'],
    ['accounting_document.wbs_code', 'WBS'],
    ['accounting_document.contract_reference', 'สัญญาอ้างอิง'],
    ['accounting_document.vat_rate', 'อัตรา VAT'],
    ['accounting_document.withholding_tax_rate', 'อัตราหัก ณ ที่จ่าย'],
    ['accounting_document.payment_status', 'สถานะชำระเงิน'],
    ['accounting_document.matching_status', 'สถานะจับคู่เอกสาร'],
    ['accounting_document.risk_level', 'ระดับความเสี่ยง'],
    ['accounting_document.risk_flags', 'สัญญาณความเสี่ยง'],
    ['financial_document.recipient_name', 'ผู้รับเงิน'],
    ['financial_document.amount_total', 'ยอดโอน'],
    ['financial_document.bank_reference', 'เลขอ้างอิงธนาคาร'],
  ] as const
  return definitions.map(([field_key, field_label]) => {
    const value = nestedValue(output, field_key)
    return {
      field_key, field_label, ai_value: value ?? null, verified_value: displayValue(value),
      verdict: value == null || value === '' ? 'missing' : 'correct',
      confidence: item.ai_confidence,
    }
  })
}

export function ImageReviewPage() {
  usePageTitle('คอนเฟิร์มรูปและสอน WisdomAI')
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [tab, setTab] = useState(0)
  const [cases, setCases] = useState<ReviewCase[]>([])
  const [purposes, setPurposes] = useState<Purpose[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [messages, setMessages] = useState<SourceMessage[]>([])
  const [samples, setSamples] = useState<LearningSample[]>([])
  const [scorecards, setScorecards] = useState<Scorecard[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [selected, setSelected] = useState<ReviewCase | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [primaryPurpose, setPrimaryPurpose] = useState('')
  const [documentType, setDocumentType] = useState('')
  const [secondaryPurposes, setSecondaryPurposes] = useState<string[]>([])
  const [projectId, setProjectId] = useState('')
  const [responsibleId, setResponsibleId] = useState('')
  const [note, setNote] = useState('')
  const [fieldReviews, setFieldReviews] = useState<FieldReview[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [caseResult, purposeResult, documentTypeResult, projectResult, profileResult, sampleResult, scoreResult, observationResult, progressResult] = await Promise.all([
      supabase.from('image_review_cases').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('image_purpose_catalog').select('code,name_th,description').eq('active', true).order('sort_order'),
      supabase.from('financial_document_type_catalog').select('code,name_th,description').eq('active', true).order('sort_order'),
      supabase.from('projects').select('id:project_id,name,code').eq('status', 'active').order('name'),
      supabase.from('profiles').select('id,full_name,email').order('full_name'),
      supabase.from('wisdom_image_learning_samples')
        .select('id,review_case_id,ai_provider,ai_model,purpose_match,project_match,document_type_match,training_status,verified_at')
        .order('verified_at', { ascending: false }).limit(500),
      supabase.from('wisdom_image_ai_scorecard').select('*').order('reviewed_samples', { ascending: false }),
      supabase.from('image_ai_observations').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('wisdom_image_progress').select('*').single(),
    ])
    const firstError = caseResult.error ?? purposeResult.error ?? documentTypeResult.error ?? projectResult.error
      ?? profileResult.error ?? sampleResult.error ?? scoreResult.error ?? observationResult.error ?? progressResult.error
    if (firstError) {
      setError(userError(firstError))
      setLoading(false)
      return
    }
    const loadedCases = (caseResult.data ?? []) as ReviewCase[]
    const messageIds = loadedCases.map((item) => item.source_message_id)
    const attachmentIds = loadedCases.flatMap((item) => item.attachment_id ? [item.attachment_id] : [])
    const [messageResult, attachmentResult] = await Promise.all([
      messageIds.length
        ? supabase.from('line_messages')
          .select('id,occurred_at,line_senders(display_name),line_groups(display_name)').in('id', messageIds)
        : Promise.resolve({ data: [], error: null }),
      attachmentIds.length
        ? supabase.from('line_attachments')
          .select('id,storage_bucket,storage_path,content_type').in('id', attachmentIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    const relatedError = messageResult.error ?? attachmentResult.error
    if (relatedError) setError(userError(relatedError))
    setCases(loadedCases)
    setPurposes((purposeResult.data ?? []) as Purpose[])
    setDocumentTypes((documentTypeResult.data ?? []) as DocumentType[])
    setProjects((projectResult.data ?? []) as Project[])
    setProfiles((profileResult.data ?? []) as Profile[])
    setSamples((sampleResult.data ?? []) as LearningSample[])
    setScorecards((scoreResult.data ?? []) as Scorecard[])
    setObservations((observationResult.data ?? []) as Observation[])
    setProgress(progressResult.data as Progress | null)
    setMessages((messageResult.data ?? []) as unknown as SourceMessage[])
    setAttachments((attachmentResult.data ?? []) as Attachment[])
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const purposeMap = useMemo(() => new Map(purposes.map((item) => [item.code, item.name_th])), [purposes])
  const documentTypeMap = useMemo(() => new Map(documentTypes.map((item) => [item.code, item.name_th])), [documentTypes])
  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects])
  const profileMap = useMemo(() => new Map(profiles.map((item) => [item.id, item])), [profiles])
  const messageMap = useMemo(() => new Map(messages.map((item) => [item.id, item])), [messages])
  const attachmentMap = useMemo(() => new Map(attachments.map((item) => [item.id, item])), [attachments])

  const openCase = async (item: ReviewCase) => {
    setSelected(item)
    setPrimaryPurpose(item.confirmed_primary_purpose || item.proposed_primary_purpose)
    setDocumentType(item.confirmed_document_type || item.proposed_document_type || '')
    setSecondaryPurposes(item.confirmed_secondary_purposes.length
      ? item.confirmed_secondary_purposes : item.proposed_secondary_purposes)
    setProjectId(item.confirmed_project_id || item.proposed_project_id || '')
    setResponsibleId(item.responsible_profile_id || '')
    setNote(item.review_note || '')
    setFieldReviews(reviewFields(item))
    setImageUrl('')
    const attachment = item.attachment_id ? attachmentMap.get(item.attachment_id) : undefined
    if (attachment) {
      const signed = await supabase.storage.from(attachment.storage_bucket)
        .createSignedUrl(attachment.storage_path, 600)
      if (signed.error) setError(userError(signed.error))
      else setImageUrl(signed.data.signedUrl)
    }
  }

  useEffect(() => {
    const caseId = searchParams.get('case')
    if (!caseId || selected?.id === caseId || cases.length === 0) return
    const target = cases.find((item) => item.id === caseId)
    if (!target) return
    const timer = window.setTimeout(() => void openCase(target), 0)
    return () => window.clearTimeout(timer)
  // `openCase` intentionally reads the latest attachment map for the requested case.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, cases, searchParams, selected?.id])

  const saveDecision = async (decision: ReviewStatus) => {
    if (!selected) return
    setSaving(true)
    setError('')
    setSuccess('')
    const corrected = primaryPurpose !== selected.proposed_primary_purpose
      || (primaryPurpose === 'financial_document' && documentType !== selected.proposed_document_type)
      || (projectId || null) !== selected.proposed_project_id
      || JSON.stringify(secondaryPurposes) !== JSON.stringify(selected.proposed_secondary_purposes)
    const finalDecision = decision === 'confirmed' && corrected ? 'corrected' : decision
    if (['confirmed', 'corrected'].includes(finalDecision)) {
      const { error: fieldError } = await supabase.rpc('save_image_review_field_checks', {
        target_case_id: selected.id,
        checks: fieldReviews.map((item) => ({
          ...item,
          ai_value: item.ai_value,
          verified_value: item.verified_value || null,
        })),
      })
      if (fieldError) {
        setError(userError(fieldError))
        setSaving(false)
        return
      }
    }
    const { error: saveError } = await supabase.rpc('confirm_image_review_case_v2', {
      target_case_id: selected.id,
      decision: finalDecision,
      primary_purpose: primaryPurpose,
      secondary_purposes: secondaryPurposes,
      project_id: projectId || null,
      responsible_id: responsibleId || null,
      note: note || null,
      corrected_output: selected.proposed_output,
      document_type: primaryPurpose === 'financial_document' ? documentType : null,
    })
    if (saveError) setError(userError(saveError))
    else {
      if (['confirmed', 'corrected'].includes(finalDecision) && primaryPurpose === 'system_error') {
        const { error: intakeError } = await supabase.rpc('register_reviewed_system_error_image', {
          target_case_id: selected.id,
          target_note: note || null,
        })
        if (intakeError) {
          setError(`ยืนยันหมวดรูปแล้ว แต่สร้างทะเบียน Error ไม่สำเร็จ: ${userError(intakeError)}`)
          setSaving(false)
          return
        }
      }
      setSuccess(finalDecision === 'corrected'
        ? 'บันทึกคำแก้ไขเป็นข้อมูลเรียนรู้ของ WisdomAI แล้ว'
        : finalDecision === 'confirmed'
          ? 'ยืนยันและส่งข้อมูลให้ WisdomAI เรียนรู้แล้ว'
          : 'อัปเดตสถานะเรียบร้อยแล้ว')
      setSelected(null)
      await load()
    }
    setSaving(false)
  }

  const runOpenSourceOcr = async () => {
    if (!selected || !imageUrl) return
    setOcrRunning(true)
    setError('')
    try {
      const startedAt = performance.now()
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['tha', 'eng'])
      const result = await worker.recognize(imageUrl)
      await worker.terminate()
      const confidence = Math.max(0, Math.min(1, Number(result.data.confidence || 0) / 100))
      const { error: observationError } = await supabase.from('image_ai_observations').upsert({
        review_case_id: selected.id,
        provider: 'tesseract',
        model: 'tesseract.js-7-eng-tha',
        role: 'ocr',
        result: {
          text: result.data.text.trim(),
          line_count: result.data.text.split('\n').filter((line) => line.trim()).length,
        },
        confidence,
        status: 'completed',
        latency_ms: Math.round(performance.now() - startedAt),
        error_message: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'review_case_id,provider,model,role' })
      if (observationError) throw observationError
      setSuccess(`Open Source OCR อ่านได้ ${result.data.text.trim().length.toLocaleString()} ตัวอักษร`)
      await load()
    } catch (ocrError) {
      setError(ocrError instanceof Error ? userError(ocrError) : 'Open Source OCR ทำงานไม่สำเร็จ')
    } finally {
      setOcrRunning(false)
    }
  }

  const pending = cases.filter((item) => ['pending', 'needs_information', 'forwarded'].includes(item.review_status))
  const confirmed = cases.filter((item) => ['confirmed', 'corrected'].includes(item.review_status))

  return <Stack spacing={3}>
    <PageHeader
      title="คอนเฟิร์มรูปและสอน WisdomAI"
      description="ตรวจไซต์ วัตถุประสงค์ ผู้รับผิดชอบ และใช้เฉพาะข้อมูลที่คนยืนยันแล้วประเมิน AI"
      action={<Button startIcon={<RefreshOutlinedIcon />} onClick={() => void load()} disabled={loading}>รีเฟรช</Button>}
    />
    {error && <Alert severity="error">{error}</Alert>}
    {success && <Alert severity="success">{success}</Alert>}
    {!canManage && <Alert severity="info">คุณจะเห็นเฉพาะรูปที่ได้รับมอบหมายให้เป็นผู้รับผิดชอบ</Alert>}
    <Paper variant="outlined">
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable">
        <Tab label={`รอคอนเฟิร์ม (${pending.length})`} />
        <Tab label={`ยืนยันแล้ว (${confirmed.length})`} />
        <Tab label={`ชุดข้อมูลเรียนรู้ (${samples.length})`} />
        <Tab label="ประเมิน AI" />
        <Tab label="ความก้าวหน้า WisdomAI" />
      </Tabs>
    </Paper>

    {progress && <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 2 }}>
      {[
        ['รับเข้าทั้งหมด', progress.total_received],
        ['รอคนตรวจ', progress.awaiting_review],
        ['ยืนยันแล้ว', progress.confirmed],
        ['มีการแก้ไข', progress.corrected],
        ['ข้อมูลถูกต้องรายช่อง', progress.correct_fields],
        ['ข้อมูลที่คนแก้', progress.corrected_fields],
      ].map(([label, value]) => <Paper key={String(label)} variant="outlined" sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="h5">{value}</Typography>
      </Paper>)}
    </Box>}

    {tab === 0 && <StandardDataTable
      rows={pending}
      getRowId={(item) => item.id}
      getSearchText={(item) => {
        const message = messageMap.get(item.source_message_id)
        return [
          purposeMap.get(item.proposed_primary_purpose), documentTypeMap.get(item.proposed_document_type || ''),
          projectMap.get(item.proposed_project_id || '')?.name,
          message?.line_groups?.display_name, message?.line_senders?.display_name,
        ].filter(Boolean).join(' ')
      }}
      searchLabel="ค้นหาไซต์ วัตถุประสงค์ กลุ่ม หรือผู้ส่ง"
      emptyText="ไม่มีรูปรอคอนเฟิร์ม"
      columns={[
        { id: 'time', label: 'เวลาส่ง', minWidth: 170, render: (item) => new Date(messageMap.get(item.source_message_id)?.occurred_at || item.created_at).toLocaleString('th-TH') },
        { id: 'source', label: 'กลุ่ม / ผู้ส่ง', minWidth: 180, render: (item) => {
          const message = messageMap.get(item.source_message_id)
          return `${message?.line_groups?.display_name || 'แชตส่วนตัว'} · ${message?.line_senders?.display_name || 'ไม่ทราบผู้ส่ง'}`
        } },
        { id: 'purpose', label: 'AI เสนอ', minWidth: 190, render: (item) => purposeMap.get(item.proposed_primary_purpose) || item.proposed_primary_purpose },
        { id: 'documentType', label: 'ชนิดเอกสาร', minWidth: 190, render: (item) => documentTypeMap.get(item.proposed_document_type || '') || '-' },
        { id: 'project', label: 'ไซต์/โครงการ', minWidth: 170, render: (item) => projectMap.get(item.proposed_project_id || '')?.name || 'ยังไม่ระบุ' },
        { id: 'ai', label: 'AI / ความมั่นใจ', minWidth: 160, render: (item) => `${item.ai_provider} · ${percent(item.ai_confidence)}` },
        { id: 'responsible', label: 'ผู้รับผิดชอบ', minWidth: 170, render: (item) => displayProfile(profileMap.get(item.responsible_profile_id || '')) },
        { id: 'action', label: 'ตรวจสอบ', render: (item) => <Button size="small" variant="contained" onClick={() => void openCase(item)}>เปิดรูป</Button> },
      ]}
    />}

    {tab === 1 && <StandardDataTable
      rows={confirmed}
      getRowId={(item) => item.id}
      getSearchText={(item) => `${purposeMap.get(item.confirmed_primary_purpose || '')} ${projectMap.get(item.confirmed_project_id || '')?.name}`}
      searchLabel="ค้นหาผลที่ยืนยันแล้ว"
      emptyText="ยังไม่มีรูปที่ยืนยันแล้ว"
      columns={[
        { id: 'time', label: 'ยืนยันเมื่อ', minWidth: 170, render: (item) => item.confirmed_at ? new Date(item.confirmed_at).toLocaleString('th-TH') : '-' },
        { id: 'purpose', label: 'วัตถุประสงค์ที่ยืนยัน', minWidth: 210, render: (item) => purposeMap.get(item.confirmed_primary_purpose || '') || item.confirmed_primary_purpose || '-' },
        { id: 'documentType', label: 'ชนิดเอกสารที่ยืนยัน', minWidth: 190, render: (item) => documentTypeMap.get(item.confirmed_document_type || '') || '-' },
        { id: 'project', label: 'โครงการ', minWidth: 170, render: (item) => projectMap.get(item.confirmed_project_id || '')?.name || 'ไม่ระบุ' },
        { id: 'status', label: 'ผลตรวจ', render: (item) => <Chip size="small" color={item.review_status === 'corrected' ? 'warning' : 'success'} label={statusLabels[item.review_status]} /> },
        { id: 'reviewer', label: 'ผู้ยืนยัน', minWidth: 170, render: (item) => displayProfile(profileMap.get(item.confirmed_by || '')) },
        { id: 'action', label: 'ดูรูป', render: (item) => <Button size="small" onClick={() => void openCase(item)}>รายละเอียด</Button> },
      ]}
    />}

    {tab === 2 && <StandardDataTable
      rows={samples}
      getRowId={(item) => item.id}
      getSearchText={(item) => `${item.ai_provider} ${item.ai_model} ${item.training_status}`}
      searchLabel="ค้นหา AI รุ่น หรือสถานะข้อมูล"
      emptyText="ยังไม่มีข้อมูลที่คนยืนยันสำหรับ WisdomAI"
      columns={[
        { id: 'time', label: 'ยืนยันเมื่อ', minWidth: 170, render: (item) => new Date(item.verified_at).toLocaleString('th-TH') },
        { id: 'ai', label: 'AI / Model', minWidth: 200, render: (item) => `${item.ai_provider} · ${item.ai_model || '-'}` },
        { id: 'purpose', label: 'วัตถุประสงค์', render: (item) => <Chip size="small" color={item.purpose_match ? 'success' : 'warning'} label={item.purpose_match ? 'AI ตรง' : 'ผู้ตรวจแก้'} /> },
        { id: 'documentType', label: 'ชนิดเอกสาร', render: (item) => item.document_type_match == null ? '-' : item.document_type_match ? 'ตรง' : 'ผู้ตรวจแก้' },
        { id: 'project', label: 'โครงการ', render: (item) => item.project_match == null ? '-' : item.project_match ? 'ตรง' : 'แก้ไข' },
        { id: 'status', label: 'พร้อมเรียนรู้', render: (item) => item.training_status },
      ]}
    />}

    {tab === 3 && <>
      {scorecards.length === 0 && <Alert severity="info">ต้องมีข้อมูลที่ผู้รับผิดชอบยืนยันก่อนจึงจะคำนวณคะแนน AI ได้</Alert>}
      <StandardDataTable
        rows={scorecards}
        getRowId={(item) => `${item.ai_provider}-${item.ai_model}`}
        getSearchText={(item) => `${item.ai_provider} ${item.ai_model}`}
        searchLabel="ค้นหา AI หรือ Model"
        emptyText="ยังไม่มีคะแนน AI"
        columns={[
          { id: 'ai', label: 'AI / Model', minWidth: 220, render: (item) => `${item.ai_provider} · ${item.ai_model}` },
          { id: 'samples', label: 'ตัวอย่างที่ตรวจแล้ว', render: (item) => item.reviewed_samples },
          { id: 'purpose', label: 'วัตถุประสงค์ถูกต้อง', minWidth: 170, render: (item) => percent(item.purpose_accuracy) },
          { id: 'documentType', label: 'ชนิดเอกสารถูกต้อง', minWidth: 170, render: (item) => item.document_type_samples ? percent(item.document_type_accuracy) : '-' },
          { id: 'project', label: 'โครงการถูกต้อง', minWidth: 160, render: (item) => percent(item.project_accuracy) },
          { id: 'confidence', label: 'ความมั่นใจเฉลี่ย', minWidth: 150, render: (item) => percent(item.average_confidence) },
          { id: 'latest', label: 'ตรวจล่าสุด', minWidth: 170, render: (item) => item.last_verified_at ? new Date(item.last_verified_at).toLocaleString('th-TH') : '-' },
        ]}
      />
    </>}

    {tab === 4 && <Stack spacing={2}>
      <Alert severity="info">
        ความก้าวหน้าคำนวณจากคำตอบที่ผู้รับผิดชอบตรวจจริง ไม่ใช้ค่าความมั่นใจของ AI แทนความถูกต้อง
      </Alert>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">ความคืบหน้าการตรวจ</Typography>
          <Typography variant="h4">{progress?.total_received ? percent(progress.confirmed / progress.total_received) : '0.0%'}</Typography>
          <Typography variant="body2">{progress?.confirmed || 0} จาก {progress?.total_received || 0} รายการ</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">อัตราที่ต้องแก้ไข</Typography>
          <Typography variant="h4">{progress?.confirmed ? percent(progress.corrected / progress.confirmed) : '0.0%'}</Typography>
          <Typography variant="body2">ยิ่งลดลง แสดงว่า WisdomAI เสนอได้แม่นขึ้น</Typography>
        </Paper>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography color="text.secondary">ความมั่นใจเฉลี่ยของ WisdomAI</Typography>
          <Typography variant="h4">{percent(progress?.average_wisdom_confidence ?? null)}</Typography>
          <Typography variant="body2">ใช้ประกอบการพิจารณา ไม่ใช่คะแนนความถูกต้อง</Typography>
        </Paper>
      </Box>
      <StandardDataTable
        rows={scorecards}
        getRowId={(item) => `${item.ai_provider}-${item.ai_model}`}
        getSearchText={(item) => `${item.ai_provider} ${item.ai_model}`}
        searchLabel="ค้นหา AI หรือรุ่น"
        emptyText="ยังไม่มีข้อมูลยืนยันเพียงพอสำหรับเปรียบเทียบ"
        columns={[
          { id: 'ai', label: 'AI / รุ่น', minWidth: 220, render: (item) => `${item.ai_provider} · ${item.ai_model}` },
          { id: 'samples', label: 'ข้อมูลทดสอบ', render: (item) => item.reviewed_samples },
          { id: 'purpose', label: 'หมวดภาพ', render: (item) => percent(item.purpose_accuracy) },
          { id: 'document', label: 'ชนิดเอกสาร', render: (item) => item.document_type_samples ? percent(item.document_type_accuracy) : '-' },
          { id: 'project', label: 'โครงการ', render: (item) => percent(item.project_accuracy) },
        ]}
      />
    </Stack>}

    <Dialog open={Boolean(selected)} onClose={() => !saving && setSelected(null)} fullWidth maxWidth="md">
      <DialogTitle>ตรวจและคอนเฟิร์มรูป</DialogTitle>
      <DialogContent>
        {selected && <Stack spacing={2} sx={{ pt: 1 }}>
          {imageUrl
            ? <Box component="img" src={imageUrl} alt="รูปจาก LINE" sx={{ width: '100%', maxHeight: 480, objectFit: 'contain', bgcolor: '#111', borderRadius: 1 }} />
            : <Alert severity="warning">ไม่พบไฟล์รูปหรือไม่สามารถเปิดไฟล์ได้</Alert>}
          <Alert severity="info">
            AI: {selected.ai_provider} · {selected.ai_model || '-'} · ความมั่นใจ {percent(selected.ai_confidence)}
          </Alert>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" gutterBottom>ผลจาก AI และโมดูลที่เกี่ยวข้อง</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {observations.filter((item) => item.review_case_id === selected.id).map((item) =>
                <Chip key={item.id} variant="outlined" color={item.status === 'completed' ? 'success' : 'default'}
                  label={`${item.provider} · ${item.model} · ${item.status === 'completed' ? percent(item.confidence) : item.status}`} />)}
            </Stack>
            {canManage && <Button sx={{ mt: 1 }} size="small" variant="outlined"
              disabled={ocrRunning || !imageUrl} onClick={() => void runOpenSourceOcr()}>
              {ocrRunning ? 'กำลังอ่านด้วย Tesseract...' : 'วิเคราะห์ OCR ด้วย Open Source'}
            </Button>}
          </Paper>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>
            {String(selected.proposed_output.summary_text || 'AI ไม่ได้สร้างคำอธิบาย')}
          </Typography>
          <Divider />
          <Typography variant="h6">ตรวจความถูกต้องรายข้อมูล</Typography>
          <Typography variant="body2" color="text.secondary">
            ตรวจทุกช่องก่อนยืนยัน ค่าเดิมจาก AI แสดงในช่องและสามารถแก้เป็นค่าที่ถูกต้องได้
          </Typography>
          {fieldReviews.map((field, index) => <Box key={field.field_key}
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '180px 1fr 180px' }, gap: 1, alignItems: 'center' }}>
            <Typography variant="body2">{field.field_label}</Typography>
            <TextField size="small" value={field.verified_value} placeholder="ไม่มีข้อมูล"
              onChange={(event) => setFieldReviews((current) => current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, verified_value: event.target.value, verdict: 'corrected' } : item))} />
            <TextField select size="small" value={field.verdict}
              onChange={(event) => setFieldReviews((current) => current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, verdict: event.target.value as FieldReview['verdict'] } : item))}>
              <MenuItem value="correct">ถูกต้อง</MenuItem>
              <MenuItem value="corrected">แก้ไขแล้ว</MenuItem>
              <MenuItem value="unreadable">อ่านไม่ได้</MenuItem>
              <MenuItem value="missing">ไม่มีข้อมูลในภาพ</MenuItem>
              <MenuItem value="not_applicable">ไม่เกี่ยวข้อง</MenuItem>
            </TextField>
          </Box>)}
          <TextField select label="วัตถุประสงค์หลัก" value={primaryPurpose} onChange={(event) => setPrimaryPurpose(event.target.value)}>
            {purposes.map((item) => <MenuItem key={item.code} value={item.code}>{item.name_th}</MenuItem>)}
          </TextField>
          {primaryPurpose === 'financial_document' && <TextField
            select required label="ชนิดเอกสารการเงิน"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            helperText="ตรวจชนิดที่ AI เสนอ แล้วแก้ไขก่อนยืนยันได้"
          >
            {documentTypes.map((item) => <MenuItem key={item.code} value={item.code}>{item.name_th}</MenuItem>)}
          </TextField>}
          <TextField
            select slotProps={{ select: { multiple: true } }}
            label="วัตถุประสงค์รอง"
            value={secondaryPurposes}
            onChange={(event) => setSecondaryPurposes(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}
          >
            {purposes.filter((item) => item.code !== primaryPurpose)
              .map((item) => <MenuItem key={item.code} value={item.code}>{item.name_th}</MenuItem>)}
          </TextField>
          <TextField select label="ไซต์/โครงการ" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <MenuItem value="">ยังไม่ระบุ</MenuItem>
            {projects.map((item) => <MenuItem key={item.id} value={item.id}>{item.code ? `${item.code} · ` : ''}{item.name}</MenuItem>)}
          </TextField>
          <TextField select label="ผู้รับผิดชอบ" value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)}>
            <MenuItem value="">ยังไม่มอบหมาย</MenuItem>
            {profiles.map((item) => <MenuItem key={item.id} value={item.id}>{displayProfile(item)}</MenuItem>)}
          </TextField>
          <TextField multiline minRows={2} label="หมายเหตุ/เหตุผลที่แก้ไข" value={note} onChange={(event) => setNote(event.target.value)} />
        </Stack>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap' }}>
        <Button disabled={saving} color="inherit" onClick={() => void saveDecision('dismissed')}>ไม่นำมาใช้</Button>
        <Button disabled={saving} color="warning" onClick={() => void saveDecision('needs_information')}>ขอข้อมูลเพิ่ม</Button>
        <Button disabled={saving || !responsibleId} onClick={() => void saveDecision('forwarded')}>ส่งต่อ</Button>
        <Button disabled={saving || !primaryPurpose || (primaryPurpose === 'financial_document' && !documentType)} variant="contained" onClick={() => void saveDecision('confirmed')}>
          {saving ? 'กำลังบันทึก...' : 'ยืนยันและสอน WisdomAI'}
        </Button>
      </DialogActions>
    </Dialog>
  </Stack>
}

