import { RefreshOutlined, Refresh } from '@mui/icons-material'
import { ArrowDropDown, Delete, Search, ContentCopy, OpenInNewOutlined } from '@mui/icons-material'
import { Alert, Box, Button, Chip, Divider, Drawer, FormControl, IconButton, Menu, MenuItem, Paper, Select, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { StandardDataTable } from '../components/StandardDataTable'
import { useAuth } from '../hooks/useAuth'
import { usePageTitle } from '../hooks/usePageTitle'
import { userError } from '../utils/userError'
import { toFriendlyError } from '../utils/error-center'
import { runWithMutationAttempt } from '../utils/mutationAttemptRunner'
import { documentFlowGateway, type ChequePaymentEvidence, type DocumentFlowScope, type TransferSlipParties } from '../services/documentFlowGateway'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'

type IntakeFlowItem = {
  id: string
  intake_id: string
  review_case_id: string | null
  source_message_id: string
  input_channel: 'line' | 'telegram' | 'web_chat' | 'unknown'
  source_entry_point: string
  source_payload: string
  source_received_at: string | null
  source: 'document_flow' | 'employee_intake'
  current_room: string
  state: string
  current_flow: string
  route_target: string | null
  document_type: string | null
  vendor_name: string | null
  confidence: number | null
  issue_codes: string[] | null
  last_error: string | null
  total_amount: number | null
  projects: { name: string } | null
  version: number
  created_at: string
  updated_at: string
  data_review_status?: 'complete' | 'incomplete' | 'recheck_required' | 'rechecked'
  data_review_note?: string | null
  transfer_parties?: TransferSlipParties | null
  cheque_evidence?: ChequePaymentEvidence | null
}

type RawProjects = { name: string } | { name: string }[] | null
type RawLineMessage = {
  id: string
  occurred_at?: string | null
  line_group_id?: string | null
  line_user_id?: string | null
  message_type?: string | null
  text_content?: string | null
  file_name?: string | null
} | null
type RawLineMessageRecord = RawLineMessage & { id: string }
type RawLineSender = { line_user_id: string; display_name: string | null }
type RawLineGroup = { line_group_id: string; display_name: string | null }

type RawDocumentFlowRow = {
  id: string
  intake_id: string
  review_case_id: string | null
  source_message_id: string
  source_channel?: string | null
  source_room_name?: string | null
  source_sender_name?: string | null
  source_received_at?: string | null
  current_room: string
  state: string
  current_flow: string | null
  route_target: string | null
  document_type: string | null
  vendor_name: string | null
  confidence: number | null
  issue_codes: string[] | null
  last_error: string | null
  total_amount: number | null
  projects: RawProjects
  version: number | null
  created_at: string
  updated_at: string
  data_review_status?: 'complete' | 'incomplete' | 'recheck_required' | 'rechecked'
  data_review_note?: string | null
}

type RawEmployeeIntake = {
  id: string
  channel: 'telegram' | 'line' | 'web_chat'
  external_chat_id: string | null
  external_user_id: string | null
  purpose: string | null
  status: string
  candidate_name: string | null
  missing_fields: string[] | null
  document_count: number
  source_started_at: string
  created_at: string
  updated_at: string
  data_review_status?: 'complete' | 'incomplete' | 'recheck_required' | 'rechecked'
  data_review_note?: string | null
}

type IssueTag = {
  label: string
  level: 'error' | 'warning' | 'default'
}

const routeTargetLabels: Record<string, string> = {
  procurement_price_reference: 'อ้างอิงราคาซื้อ',
  purchase_order: 'ใบสั่งซื้อ',
  goods_receipt_stock: 'การรับของเข้าคลัง',
  billing_match: 'วางบิล/แมตช์',
  accounts_payable_tax: 'AP / ภาษี',
  document_reference: 'เอกสารอ้างอิง',
}
type PreviewFile = { url: string; contentType: string | null; label: string }

const documentTypeLabels: Record<string, string> = {
  transfer_slip: 'สลิปโอนเงิน', quotation: 'ใบเสนอราคา', purchase_order: 'ใบสั่งซื้อ',
  goods_receipt: 'ใบรับสินค้า', delivery_note: 'ใบส่งสินค้า', billing_note: 'ใบวางบิล',
  invoice: 'ใบแจ้งหนี้', receipt: 'ใบเสร็จรับเงิน', cash_receipt: 'บิลเงินสด', tax_invoice_full: 'ใบกำกับภาษี',
  payroll: 'เอกสารเงินเดือน', cheque_payment: 'เช็คสั่งจ่าย', unreadable: 'อ่านไม่ได้', other: 'เอกสารอื่น',
}

const stateLabels: Record<string, string> = {
  received: 'รับเข้าแล้ว',
  ai_processing: 'AI กำลังวิเคราะห์',
  awaiting_classification: 'รอคัดแยก',
  needs_correction: 'รอแก้ไข',
  duplicate_hold: 'พักเอกสารซ้ำ',
  failed: 'ทำงานไม่สำเร็จ',
  rejected: 'ไม่อนุมัติ',
  dismissed: 'ยกเลิก / Dead-letter',
  hr_information_needed: 'รอข้อมูลสำรองจากพนักงาน',
  hr_pending_approval: 'รออนุมัติ Admin',
  hr_approved: 'อนุมัติแล้ว',
  hr_rejected: 'ไม่อนุมัติ',
  hr_cancelled: 'ยกเลิก',
  awaiting_purpose: 'รอระบุวัตถุประสงค์',
  collecting_documents: 'กำลังรับเอกสาร',
  extracting: 'กำลังอ่านข้อมูล',
  information_required: 'รอข้อมูลเพิ่ม',
  pending_review: 'รออนุมัติ HR',
  approved: 'อนุมัติแล้ว',
  cancelled: 'ยกเลิก',
}

function formatConfidence(value: number | null) {
  return value == null ? '-' : `${(value * 100).toFixed(1)}%`
}
const dataReviewLabels = { complete: 'ข้อมูลครบถ้วน', incomplete: 'ข้อมูลไม่ครบ', recheck_required: 'แก้ไขแล้ว · รอตรวจซ้ำ', rechecked: 'ตรวจซ้ำผ่าน' } as const
const dataReviewColor = (status?: IntakeFlowItem['data_review_status']) => status === 'incomplete' ? 'error' : status === 'recheck_required' ? 'warning' : status === 'rechecked' ? 'info' : 'success'

function formatSourcePath(rawMessage: RawLineMessage, groupName?: string | null, senderName?: string | null) {
  if (!rawMessage) return 'เส้นทางไม่ระบุ'

  const group = groupName?.trim()
    ?? (rawMessage.line_group_id ? 'กลุ่ม LINE' : null)
  const sender = senderName?.trim()
    ?? rawMessage.line_user_id
    ?? 'ไม่ทราบผู้ส่ง'

  if (group && sender) return `${group} / ${sender}`
  if (group) return group
  if (sender) return sender
  return 'เส้นทางไม่ระบุ'
}

function formatEmployeeSource(item: RawEmployeeIntake) {
  const channel = item.channel === 'line' ? 'LINE' : item.channel === 'telegram' ? 'Telegram' : 'Web Chat'
  const room = item.external_chat_id?.trim() || item.external_user_id?.trim()
  return room ? `${channel} / ${room}` : channel
}

function paymentPartyLabel(parties?: TransferSlipParties | null) {
  if (!parties) return '-'
  const from = [parties.sender_name, parties.sender_bank_name, parties.sender_account_last4 ? `•••• ${parties.sender_account_last4}` : null].filter(Boolean).join(' · ') || 'ต้นทางไม่ระบุ'
  const to = [parties.recipient_name, parties.recipient_bank_name, parties.recipient_account_last4 ? `•••• ${parties.recipient_account_last4}` : null].filter(Boolean).join(' · ') || 'ปลายทางไม่ระบุ'
  return `${from} → ${to}`
}

function issueInfo(codes: string[] | null): IssueTag[] {
  if (!codes || codes.length === 0) return []
  const mapIssue = (code: string): IssueTag => {
    const normalized = code.toLowerCase()
    if (normalized.includes('possible_duplicate') || normalized.includes('duplicate')) {
      return { label: 'เอกสารอาจซ้ำ', level: 'error' }
    }
    if (normalized.includes('needs_information')) {
      return { label: 'ต้องการข้อมูลเพิ่มเติม', level: 'warning' }
    }
    if (normalized.includes('document_needs_correction')) {
      return { label: 'ต้องแก้ไขข้อมูล', level: 'warning' }
    }
    if (normalized.includes('confidence_below_auto_threshold')) {
      return { label: 'AI คาดการณ์ต่ำกว่าเกณฑ์', level: 'warning' }
    }
    if (normalized.includes('quality') || normalized.includes('blur') || normalized.includes('glare') || normalized.includes('missing')) {
      return { label: 'คุณภาพไฟล์ต่ำ', level: 'warning' }
    }
    if (normalized.includes('unreadable') || normalized.includes('error')) {
      return { label: 'อ่านไฟล์ไม่ชัด/พบข้อผิดพลาด', level: 'error' }
    }
    return { label: `Issue: ${code}`, level: 'default' }
  }

  return codes.map(mapIssue)
}

type QueueStatusTag = {
  color: 'error' | 'warning' | 'info' | 'success'
  label: string
  tone: 'danger' | 'warning' | 'info' | 'success'
  icon: string
}

function classifyQueueState(item: IntakeFlowItem): QueueStatusTag {
  const hasIssue = !!item.last_error || (item.issue_codes?.length ?? 0) > 0
  const lowConfidence = (item.confidence ?? 1) < 0.9
  if (['failed', 'rejected'].includes(item.state)) {
    return { color: 'error', label: 'สถานะล้มเหลว/ตีกลับ', tone: 'danger', icon: '⚠️' }
  }
  if (item.state === 'duplicate_hold') {
    return { color: 'warning', label: 'เอกสารซ้ำถูก hold', tone: 'warning', icon: '🔁' }
  }
  if (item.state === 'needs_correction') {
    return { color: 'warning', label: 'รอปรับปรุงข้อมูล', tone: 'warning', icon: '✏️' }
  }
  if (item.current_room.toLowerCase().includes('manual')) {
    return { color: 'info', label: 'รอมือ', tone: 'info', icon: '🧑' }
  }
  if (hasIssue) {
    return { color: 'warning', label: 'มี Issue', tone: 'warning', icon: '🟠' }
  }
  if (lowConfidence) {
    return { color: 'warning', label: 'AI ต่ำกว่า 90%', tone: 'warning', icon: '⚡' }
  }
  if (item.state === 'awaiting_classification') {
    return { color: 'info', label: 'รอคัดแยก', tone: 'info', icon: '🔎' }
  }
  return { color: 'success', label: 'ลื่นไหล', tone: 'success', icon: '✅' }
}

type IntakeRoomPanelProps = {
  tableToolsRef?: MutableRefObject<IntakeRoomTableTools | null>
  queueView?: IntakeQueueView
  globalScope?: DocumentFlowScope
  onVisibleCountChange?: (count: number) => void
}

export type IntakeQueueView = 'all' | 'admin' | 'quality' | 'unreadable' | 'missing' | 'duplicate' | 'failed'

export type IntakeRoomTableTools = {
  refresh: () => Promise<void>
  openColumnSettings: (anchorEl: HTMLElement | null) => void
  exportCsv: () => void
  exportPdf: () => void
}

export function IntakeRoomPanel({
  tableToolsRef,
  queueView = 'all',
  globalScope,
  onVisibleCountChange,
}: IntakeRoomPanelProps) {
  usePageTitle('Intake Room')
  const [items, setItems] = useState<IntakeFlowItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [channelFilter, setChannelFilter] = useState<'all' | 'line' | 'telegram' | 'web_chat' | 'unknown'>('all')
  const [receivedDate, setReceivedDate] = useState('')
  const [error, setError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionRowId, setActionRowId] = useState('')
  const [actionMenuAnchorEl, setActionMenuAnchorEl] = useState<null | HTMLElement>(null)
  const [actionMenuRow, setActionMenuRow] = useState<IntakeFlowItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<IntakeFlowItem | null>(null)
  const [drawerNote, setDrawerNote] = useState('')
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewMessage, setPreviewMessage] = useState('')
  const previewRequestRef = useRef(0)
  const inputChannelTab = globalScope?.channel ?? channelFilter
  // Kept only for one hot-reload cycle: this message belonged to the former
  // all-or-nothing source lookup and must never block the queue UI.
  const visibleError = error.startsWith('โหลดเส้นทางต้นทางไม่ครบ:') ? '' : error

  const openActionMenu = useCallback((anchorEl: HTMLElement, row: IntakeFlowItem) => {
    setActionMenuAnchorEl(anchorEl)
    setActionMenuRow(row)
  }, [])

  const closeActionMenu = useCallback(() => {
    setActionMenuAnchorEl(null)
    setActionMenuRow(null)
  }, [])

  const openSourcePreview = useCallback(async (item: IntakeFlowItem) => {
    const requestId = ++previewRequestRef.current
    setSelectedItem(item)
    setDrawerNote('')
    setPreviewFiles([])
    setPreviewIndex(0)
    setPreviewMessage('กำลังเปิดไฟล์ต้นฉบับ…')
    try {
      if (item.source === 'employee_intake') {
        const result = await documentFlowGateway.employeeIntakePreview(item.id)
        if (requestId !== previewRequestRef.current) return
        if (result.error || !result.data) { setPreviewMessage(result.error ? `เปิดไฟล์ไม่ได้: ${userError(result.error)}` : 'ไม่พบไฟล์ต้นฉบับของ Intake HR'); return }
        const signed = await documentFlowGateway.signedPreviewUrl(result.data.storage_bucket, result.data.storage_path)
        if (requestId !== previewRequestRef.current) return
        if (!signed.data?.signedUrl) { setPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(signed.error ?? new Error('สร้างลิงก์ไม่สำเร็จ'))}`); return }
        setPreviewFiles([{ url: signed.data.signedUrl, contentType: result.data.mime_type ?? null, label: 'ไฟล์ 1' }]); setPreviewMessage(''); return
      }
      const result = await documentFlowGateway.preview(item.id)
      if (requestId !== previewRequestRef.current) return
      if (result.error) { setPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(result.error)}`); return }
      const data = result.data as { reason?: string; files?: { bucket: string; path: string; content_type?: string | null }[] } | null
      if (!data?.files?.length) { setPreviewMessage(data?.reason ?? 'ไม่พบไฟล์ต้นฉบับที่ผูกกับรายการนี้'); return }
      const signedFiles = await Promise.all(data.files.map(async (file, index) => {
        const signed = await documentFlowGateway.signedPreviewUrl(file.bucket, file.path)
        return signed.data?.signedUrl ? { url: signed.data.signedUrl, contentType: file.content_type ?? null, label: `ไฟล์ ${index + 1}` } : null
      }))
      if (requestId !== previewRequestRef.current) return
      const available = signedFiles.filter((file): file is PreviewFile => Boolean(file))
      if (!available.length) { setPreviewMessage('สร้างลิงก์เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่หรือแจ้งผู้ดูแลระบบ'); return }
      setPreviewFiles(available); setPreviewMessage('')
    } catch (previewError) {
      if (requestId !== previewRequestRef.current) return
      setPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(previewError)}`)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const effectiveScope: DocumentFlowScope = globalScope ?? { channel: channelFilter, date: receivedDate || undefined }
    const intakeResult = await documentFlowGateway.loadIntakeQueue(effectiveScope)
    const [response, employeeResponse] = intakeResult

    if (response.error) {
      setError(`โหลด Intake Room ไม่สำเร็จ: ${userError(response.error)}`)
      setLoading(false)
      return
    }
    if (employeeResponse.error) {
      setError((previous) => previous || `โหลดคิว Intake HR ไม่สำเร็จ: ${userError(employeeResponse.error)}`)
    }
    const documentRows = (response.data ?? []) as unknown as RawDocumentFlowRow[]
    const sourceMessageIds = Array.from(new Set(documentRows.map((row) => row.source_message_id)))
    const sourceMessageMap = new Map<string, RawLineMessage | null>()
    const transferPartyMap = new Map<string, TransferSlipParties>()
    const chequeEvidenceMap = new Map<string, ChequePaymentEvidence>()
    const senderNameMap = new Map<string, string | null>()
    const groupNameMap = new Map<string, string | null>()
    if (sourceMessageIds.length > 0 && !globalScope?.localTestData) {
      const { messages: messageResponse, senders: sendersResponse, groups: groupsResponse } = await documentFlowGateway.loadSourceMessages(sourceMessageIds)

      if (messageResponse.error) {
        // Source enrichment is optional.  Keep the central Intake queue usable
        // and use the row fallback instead of showing a page-level failure.
        console.warn('Intake source message lookup failed', messageResponse.error)
      } else {
        const sourceMessages = (messageResponse.data as unknown as RawLineMessageRecord[]) ?? []
        for (const item of sourceMessages) {
          sourceMessageMap.set(item.id, item)
        }

        if (!sendersResponse || !groupsResponse || sendersResponse.error || groupsResponse.error) {
          const lookupError = sendersResponse?.error ?? groupsResponse?.error ?? new Error('ไม่พบข้อมูลต้นทาง')
          console.warn('Intake sender/group lookup failed', lookupError)
        } else {
          for (const sender of (sendersResponse.data as RawLineSender[]) ?? []) {
            senderNameMap.set(sender.line_user_id, sender.display_name)
          }
          for (const group of (groupsResponse.data as RawLineGroup[]) ?? []) {
            groupNameMap.set(group.line_group_id, group.display_name)
          }
        }
      }
      const transferPartyResponse = await documentFlowGateway.loadTransferSlipParties(sourceMessageIds)
      if (transferPartyResponse.error) console.warn('Intake transfer-slip party lookup failed', transferPartyResponse.error)
      else for (const parties of transferPartyResponse.data ?? []) transferPartyMap.set(parties.source_message_id, parties)
      const chequeResponse = await documentFlowGateway.loadChequePaymentEvidence(sourceMessageIds)
      if (chequeResponse.error) console.warn('Intake cheque evidence lookup failed', chequeResponse.error)
      else for (const evidence of chequeResponse.data ?? []) chequeEvidenceMap.set(evidence.source_message_id, evidence)
    }

    const documentFlowItems: IntakeFlowItem[] = documentRows.map((row) => {
      const typedRow = row as RawDocumentFlowRow
      const projectRecord = Array.isArray(typedRow.projects)
        ? typedRow.projects[0]
        : typedRow.projects
      const sourceMessage = sourceMessageMap.get(typedRow.source_message_id) ?? null

      return {
        id: typedRow.id,
        intake_id: typedRow.intake_id,
        review_case_id: typedRow.review_case_id,
        source_message_id: typedRow.source_message_id,
        input_channel: typedRow.source_channel === 'line' || typedRow.source_channel === 'telegram' || typedRow.source_channel === 'web_chat' ? typedRow.source_channel : 'unknown',
        source_entry_point: typedRow.source_room_name || typedRow.source_sender_name ? [typedRow.source_room_name, typedRow.source_sender_name].filter(Boolean).join(' / ') : formatSourcePath(
          sourceMessage,
          sourceMessage?.line_group_id ? groupNameMap.get(sourceMessage.line_group_id) : null,
          sourceMessage?.line_user_id ? senderNameMap.get(sourceMessage.line_user_id) : null,
        ),
        source_payload: sourceMessage?.text_content || sourceMessage?.file_name || sourceMessage?.message_type || 'ไม่พบข้อความ/ชื่อไฟล์ต้นทาง',
        source_received_at: typedRow.source_received_at ?? sourceMessage?.occurred_at ?? null,
        source: 'document_flow',
        current_room: typedRow.current_room,
        state: typedRow.state,
        current_flow: typedRow.current_flow ?? 'intake',
        route_target: typedRow.route_target,
        document_type: typedRow.document_type,
        vendor_name: typedRow.vendor_name,
        confidence: typedRow.confidence,
        issue_codes: typedRow.issue_codes,
        last_error: typedRow.last_error,
        total_amount: typedRow.total_amount,
        projects: projectRecord && 'name' in projectRecord ? { name: String(projectRecord.name) } : null,
        version: Number(typedRow.version ?? 1),
        created_at: typedRow.created_at,
        updated_at: typedRow.updated_at,
        data_review_status: typedRow.data_review_status,
        data_review_note: typedRow.data_review_note,
        transfer_parties: transferPartyMap.get(typedRow.source_message_id) ?? null,
        cheque_evidence: chequeEvidenceMap.get(typedRow.source_message_id) ?? null,
      }
    })

    const employeeItems: IntakeFlowItem[] = ((employeeResponse.data ?? []) as RawEmployeeIntake[]).map((item) => ({
      id: item.id,
      intake_id: item.id,
      review_case_id: null,
      source_message_id: '',
      input_channel: item.channel,
      source_entry_point: formatEmployeeSource(item),
      source_payload: item.purpose ?? 'เอกสารรับเข้าฝ่าย HR',
      source_received_at: item.source_started_at,
      source: 'employee_intake',
      current_room: 'hr_initial_review',
      state: item.status,
      current_flow: 'intake',
      route_target: 'hr_initial_review',
      document_type: 'hr_employee_document',
      vendor_name: item.candidate_name,
      confidence: null,
      issue_codes: item.missing_fields?.length ? ['hr_information_missing'] : [],
      last_error: item.status === 'failed' ? 'HR intake failed' : null,
      total_amount: null,
      projects: null,
      version: 1,
      created_at: item.created_at,
      updated_at: item.updated_at,
      data_review_status: item.missing_fields?.length ? 'incomplete' : 'complete',
      data_review_note: item.missing_fields?.length ? item.missing_fields.join(', ') : null,
    }))

    const merged = [...documentFlowItems, ...employeeItems]
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    setItems(merged)

    setLoading(false)
  }, [channelFilter, globalScope, receivedDate])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const matchesQueueView = (item: IntakeFlowItem) => {
      const issue = (item.issue_codes ?? []).join(' ').toLowerCase()
      if (queueView === 'all') return true
      if (queueView === 'admin') return item.current_room.includes('manual') || item.source === 'employee_intake'
      if (queueView === 'quality') return item.current_room.includes('low_quality') || issue.includes('quality') || issue.includes('confidence')
      if (queueView === 'unreadable') return item.current_room.includes('unreadable') || issue.includes('unreadable') || issue.includes('missing_content')
      if (queueView === 'missing') return issue.includes('missing') || issue.includes('needs_information') || item.state === 'information_required'
      if (queueView === 'duplicate') return item.current_room.includes('duplicate') || item.state === 'duplicate_hold' || issue.includes('duplicate')
      return ['failed', 'rejected'].includes(item.state) || Boolean(item.last_error)
    }
    return items.filter((item) => matchesQueueView(item)
      && (inputChannelTab === 'all' || (inputChannelTab === 'hr' ? item.source === 'employee_intake' : item.input_channel === inputChannelTab)))
  }, [inputChannelTab, items, queueView])

  useEffect(() => { onVisibleCountChange?.(visible.length) }, [onVisibleCountChange, visible.length])
  const { profile, currentCompany } = useAuth()
  const workflowTransition = useCallback(async (item: IntakeFlowItem, action: 'route_filter' | 'retry' | 'recover' | 'dead_letter', note: string): Promise<boolean> => {
    if (item.source !== 'document_flow') return false
    if (!item.id) return false
    if (!window.confirm(`ยืนยัน${note}รายการนี้ใช่ไหม`)) return false
    const request = {
      target_item_id: item.id,
      target_action: action,
      target_expected_version: item.version,
      note,
    }

    setActionLoading(true)
    setActionMessage('')
    setActionRowId(item.id)
    setError('')
    try {
      await runWithMutationAttempt({
        module:'intake-room',
        action:`workflow:${action}`,
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: async () => {
          const result = await documentFlowGateway.transition({
            itemId: item.id,
            action,
            expectedVersion: item.version,
            eventKey: `intake_room:${action}:${item.id}:${Date.now()}:${crypto.randomUUID()}`,
            note,
          })
          if (result.error) {
            const friendly = toFriendlyError({
              error: result.error,
              module: 'document_flow_transition',
              responseStatus: 500,
              responseStatusText: 'RPC Failed',
              fallback: 'ดำเนินการกับ workflow ไม่สำเร็จ',
            })
            throw new Error(friendly.message)
          }
          return result
        },
        errorAction: 'ดำเนินการกับ workflow ไม่สำเร็จ',
        errorCode: 'UNHANDLED',
      })

      setActionMessage(`ทำ ${note} สำเร็จ`)
      await load()
      return true
    } catch (err) {
      const friendly = toFriendlyError({
        error: err,
        module: 'document_flow_transition',
        fallback: 'ไม่สามารถเรียก workflow action ได้',
      })
      setError(`${friendly.message}\\nแนวทาง: ${friendly.action}`)
      return false
    } finally {
      setActionLoading(false)
      setActionRowId('')
    }
  }, [currentCompany, load, profile])

  const employeeIntakeTransition = useCallback(async (
    item: IntakeFlowItem,
    action: 'approve' | 'request_more' | 'cancel' | 'revert_approval',
  ): Promise<boolean> => {
    if (item.source !== 'employee_intake') return false
    const actionLabel = {
      approve: 'อนุมัติส่งต่อ HR',
      request_more: 'ขอข้อมูลเพิ่ม',
      cancel: 'ยกเลิก Intake HR',
      revert_approval: 'ย้อนการอนุมัติ HR',
    }[action]
    if (!window.confirm(`ยืนยัน${actionLabel}ใช่ไหม`)) return false
    setActionLoading(true)
    setActionRowId(item.id)
    setActionMessage('')
    setError('')
    try {
      const result = await documentFlowGateway.reviewEmployeeIntake({
        action,
        intakeId: item.id,
      })
      if (result.error || (result.data && result.data.ok === false)) {
        throw result.error ?? new Error(result.data?.error ?? 'ดำเนินการ HR Intake ไม่สำเร็จ')
      }
      const approvalStatus = action === 'approve' ? result.data?.result_status : undefined
      setActionMessage(
        approvalStatus === 'approved_and_documents_linked'
          ? 'อนุมัติสำเร็จ · สร้าง/อัปเดตทะเบียนพนักงานและเชื่อมเอกสารแนบแล้ว'
          : approvalStatus === 'already_approved'
            ? 'รายการนี้อนุมัติและมีทะเบียนพนักงานอยู่แล้ว · ตรวจสอบ/ซ่อมสถานะให้เรียบร้อย'
            : `${actionLabel}สำเร็จ`,
      )
      await load()
      return true
    } catch (err) {
      const friendly = toFriendlyError({ error: err, module: 'employee_intake', fallback: 'ดำเนินการ HR Intake ไม่สำเร็จ' })
      setError(`${friendly.message}\nแนวทาง: ${friendly.action}`)
      return false
    } finally {
      setActionLoading(false)
      setActionRowId('')
    }
  }, [load])

  return (
    <Stack spacing={2.5}>
      {visibleError && <Alert severity="error" onClose={() => setError('')}>{visibleError}</Alert>}
      {actionMessage && <Alert severity="success" onClose={() => setActionMessage('')}>{actionMessage}</Alert>}
      <Paper variant="outlined">
        <StandardDataTable
          key={`intake-room-table-${inputChannelTab}-${queueView}`}
          rows={visible}
          emptyText={visible.length === 0
            ? (globalScope?.localTestData ? 'ไม่พบข้อมูลตามตัวกรองปัจจุบัน · ล้างตัวกรองเพื่อดูชุด Local Test Data' : 'ไม่พบข้อมูลตามตัวกรองปัจจุบัน · ล้างตัวกรองหรือเลือกช่วงวันที่ใหม่')
            : 'ไม่พบข้อมูล'}
          getRowId={(row) => row.id}
          exportFileName="intake-room-queue"
          hideBuiltInToolbarActions
          flatToolbar
          onToolsReady={(tools) => { if (tableToolsRef) tableToolsRef.current = { ...tools, refresh: load } }}
          toolbar={(tableTools) => {
            if (tableToolsRef) tableToolsRef.current = { ...tableTools, refresh: load }
            return <Stack
              direction="row"
              spacing={1}
              sx={{ width: { xs: '100%', sm: 'auto' }, flexWrap: 'wrap', alignItems: 'center' }}
            >
              {!tableToolsRef ? <Tooltip title="รีเฟรช">
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshOutlined />
                </IconButton>
              </Tooltip>
              : null}
              {!globalScope && <FormControl size="small" sx={{ minWidth: 150 }}>
                <Select displayEmpty value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as typeof channelFilter)}>
                  <MenuItem value="all">ทุกช่องทาง</MenuItem>
                  <MenuItem value="line">LINE</MenuItem>
                  <MenuItem value="telegram">Telegram</MenuItem>
                  <MenuItem value="web_chat">Web Chat</MenuItem>
                  <MenuItem value="unknown">ไม่ทราบต้นทาง</MenuItem>
                </Select>
              </FormControl>}
              {!globalScope && <><TextField size="small" type="date" label="วันที่รับเข้า" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ minWidth: 170 }} />
              {receivedDate ? <Button size="small" variant="outlined" onClick={() => setReceivedDate('')}>ทุกวัน</Button> : <Button size="small" variant="outlined" onClick={() => setReceivedDate(new Date().toLocaleDateString('en-CA'))}>วันนี้</Button>}</>}
              {!tableToolsRef ? <Tooltip title="ตั้งค่าคอลัมน์ที่แสดง">
                <span>
                  <IconButton
                    size="small"
                    color="default"
                    onClick={(event) => tableTools.openColumnSettings(event.currentTarget)}
                  >
                    <SettingsOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              : null}
              {!tableToolsRef ? <Tooltip title="Export CSV">
                <span>
                  <IconButton
                    size="small"
                    color="default"
                    onClick={tableTools.exportCsv}
                  >
                    <DownloadOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              : null}
              {!tableToolsRef ? <Tooltip title="Export PDF">
                <span>
                  <IconButton
                    size="small"
                    color="default"
                    onClick={tableTools.exportPdf}
                  >
                    <PictureAsPdfOutlinedIcon />
                  </IconButton>
                </span>
              </Tooltip>
              : null}
            </Stack>
          }}
          onRowClick={(row) => {
            ++previewRequestRef.current
            setSelectedItem(row)
            setDrawerNote('')
            setPreviewFiles([])
            setPreviewIndex(0)
            setPreviewMessage('')
          }}
          columns={[
            {
              id: 'source',
              label: 'เส้นทางที่เข้ามา',
              minWidth: 180,
              render: (row) => row.source_entry_point,
              exportValue: (row) => row.source_entry_point,
            },
            {
              id: 'source_time',
              label: 'เวลาเข้ามา',
              minWidth: 170,
              render: (row) => row.source_received_at ? new Date(row.source_received_at).toLocaleString('th-TH') : 'ไม่ระบุเวลา',
              sortValue: (row) => row.source_received_at ? new Date(row.source_received_at).getTime() : 0,
              exportValue: (row) => row.source_received_at ?? '',
            },
            {
              id: 'source_payload',
              label: 'ข้อความ/ไฟล์ต้นทาง',
              minWidth: 260,
              render: (row) => <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>{row.source_payload}</Typography>,
              exportValue: (row) => row.source_payload,
            },
            { id: 'file_kind', label: 'ชนิดข้อมูล', minWidth: 135, render: (row) => row.review_case_id ? 'รูปภาพ/สแกน' : 'เอกสาร' },
            { id: 'document_type', label: 'AI แยกประเภท', minWidth: 175, render: (row) => documentTypeLabels[row.document_type ?? 'other'] ?? row.document_type ?? 'รอ AI วิเคราะห์', exportValue: (row) => row.document_type ?? '' },
            { id: 'payment_parties', label: 'คู่โอนเงิน', minWidth: 300, visible: false, render: (row) => row.document_type === 'transfer_slip' ? <Typography variant="body2" noWrap sx={{ maxWidth: 360 }}>{paymentPartyLabel(row.transfer_parties)}</Typography> : '-', exportValue: (row) => row.document_type === 'transfer_slip' ? paymentPartyLabel(row.transfer_parties) : '' },
            {
              id: 'confidence',
              label: 'AI',
              minWidth: 100,
              align: 'right',
              render: (row) => <Chip size="small" color={(row.confidence ?? 0) >= 0.9 ? 'success' : 'warning'} label={formatConfidence(row.confidence)} />,
              sortValue: (row) => row.confidence ?? 0,
            },
            {
              id: 'issues',
              label: 'Issue',
              minWidth: 230,
              render: (row) => {
                const issues = issueInfo(row.issue_codes)
                if (issues.length === 0) return '-'
                return (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                    {issues.map((issue) => <Chip key={issue.label} size="small" color={issue.level} label={issue.label} />)}
                  </Stack>
                )
              },
              exportValue: (row) => (row.issue_codes ?? []).join(','),
            },
            { id: 'data_review', label: 'ข้อมูล', minWidth: 185, render: (row) => <Stack spacing={.25}><Chip size="small" color={dataReviewColor(row.data_review_status)} label={dataReviewLabels[row.data_review_status ?? 'complete']} />{row.data_review_note && <Typography variant="caption" noWrap sx={{ maxWidth: 175 }}>{row.data_review_note}</Typography>}</Stack>, exportValue: (row) => dataReviewLabels[row.data_review_status ?? 'complete'] },
            {
              id: 'status',
              label: 'สถานะล่าสุด',
              minWidth: 170,
              render: (row) => <Chip size="small" color={classifyQueueState(row).color} label={stateLabels[row.state] ?? row.state} />,
              exportValue: (row) => stateLabels[row.state] ?? row.state,
            },
            ...[{
                 id: 'actions',
                 label: 'Actions',
                 minWidth: 320,
                render: (row: IntakeFlowItem) => {
                  return (
                    <Button
                      size="small"
                      variant="outlined"
                      endIcon={<ArrowDropDown />}
                      onClick={(event) => openActionMenu(event.currentTarget, row)}
                      disabled={actionLoading && actionRowId === row.id}
                    >
                      จัดการ
                    </Button>
                  )
                },
               }],
          ]}
          getRowSx={(row) => {
            const queue = classifyQueueState(row)
            if (queue.tone === 'danger') return { backgroundColor: 'error.50', borderLeft: '4px solid', borderColor: 'error.main' }
            if (queue.tone === 'warning') return { backgroundColor: 'warning.50', borderLeft: '4px solid', borderColor: 'warning.main' }
            if (queue.tone === 'info') return { backgroundColor: 'info.50', borderLeft: '4px solid', borderColor: 'info.main' }
            return { backgroundColor: 'success.50', borderLeft: '4px solid', borderColor: 'success.main' }
          }}
        />
      <Menu
          anchorEl={actionMenuAnchorEl}
          open={Boolean(actionMenuAnchorEl)}
          onClose={closeActionMenu}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          {actionMenuRow ? (
            <>
              <MenuItem
                onClick={() => {
                  closeActionMenu()
                  if (actionMenuRow.review_case_id) {
                    void openSourcePreview(actionMenuRow)
                  } else {
                    setActionMessage('ยังไม่มีข้อมูลรีวิวสำหรับรายการนี้')
                  }
                }}
              >
                <Search sx={{ mr: 0.5 }} fontSize="small" />
                ดูเอกสาร
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeActionMenu()
                  void navigator.clipboard.writeText(actionMenuRow.intake_id)
                  setActionMessage(`คัดลอก Intake ID: ${actionMenuRow.intake_id}`)
                }}
              >
                <ContentCopy sx={{ mr: 0.5 }} fontSize="small" />
                คัดลอก ID
              </MenuItem>
              {actionMenuRow.source === 'employee_intake' ? <>
              <MenuItem
                disabled={actionMenuRow.state !== 'pending_review'}
                onClick={() => { closeActionMenu(); void employeeIntakeTransition(actionMenuRow, 'approve') }}
              >
                อนุมัติส่งต่อ HR
              </MenuItem>
              <MenuItem
                disabled={['approved', 'cancelled'].includes(actionMenuRow.state)}
                onClick={() => { closeActionMenu(); void employeeIntakeTransition(actionMenuRow, 'request_more') }}
              >
                ขอข้อมูลเพิ่ม
              </MenuItem>
              <MenuItem
                disabled={actionMenuRow.state === 'cancelled'}
                onClick={() => { closeActionMenu(); void employeeIntakeTransition(actionMenuRow, 'cancel') }}
              >
                ยกเลิก Intake HR
              </MenuItem>
              <MenuItem
                disabled={actionMenuRow.state !== 'approved'}
                onClick={() => { closeActionMenu(); void employeeIntakeTransition(actionMenuRow, 'revert_approval') }}
              >
                ย้อนการอนุมัติ
              </MenuItem>
              </> : <>
              <MenuItem
                disabled={!['failed', 'rejected'].includes(actionMenuRow.state)}
                onClick={() => {
                  closeActionMenu()
                  void workflowTransition(actionMenuRow, 'retry', 'Retry')
                }}
              >
                <Refresh sx={{ mr: 0.5 }} fontSize="small" />
                Retry
              </MenuItem>
              <MenuItem
                disabled={actionMenuRow.current_flow !== 'intake' || (actionMenuRow.issue_codes?.length ?? 0) > 0 || actionMenuRow.state === 'duplicate_hold'}
                onClick={() => { closeActionMenu(); void workflowTransition(actionMenuRow, 'route_filter', 'ยืนยันผ่าน Intake และส่งเข้า Filter') }}
              >
                ส่งเข้า Filter
              </MenuItem>
              <MenuItem
                onClick={() => {
                  closeActionMenu()
                  void (actionMenuRow.state === 'dismissed'
                    ? workflowTransition(actionMenuRow, 'recover', 'Recover')
                    : workflowTransition(actionMenuRow, 'dead_letter', 'Dead-letter'))
                }}
              >
                <Delete sx={{ mr: 0.5 }} fontSize="small" />
                {actionMenuRow.state === 'dismissed' ? 'Recover' : 'Dead-letter'}
              </MenuItem>
              </>}
            </>
          ) : null}
      </Menu>
      <Drawer anchor="right" open={Boolean(selectedItem)} onClose={() => { ++previewRequestRef.current; setSelectedItem(null); setPreviewFiles([]); setPreviewIndex(0); setPreviewMessage('') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 500 }, p: 3 } } }}>
        {selectedItem && <Stack spacing={2}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'start' }}><div><Typography variant="overline" color="text.secondary">ตรวจรับข้อมูลเข้า</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{selectedItem.document_type === 'hr_employee_document' ? 'เอกสาร HR' : routeTargetLabels[selectedItem.route_target ?? ''] ?? 'เอกสารรับเข้า'}</Typography></div><Chip color={classifyQueueState(selectedItem).color} label={classifyQueueState(selectedItem).label} /></Stack>
          <Divider />
          <Stack spacing={1}><Typography variant="caption" color="text.secondary">เส้นทางและผู้ส่ง</Typography><Typography>{selectedItem.source_entry_point}</Typography><Typography variant="caption" color="text.secondary">เวลารับเข้า</Typography><Typography>{selectedItem.source_received_at ? new Date(selectedItem.source_received_at).toLocaleString('th-TH') : 'ไม่ระบุ'}</Typography><Typography variant="caption" color="text.secondary">ผลคุณภาพ / Issue</Typography><Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{issueInfo(selectedItem.issue_codes).length ? issueInfo(selectedItem.issue_codes).map((issue) => <Chip key={issue.label} size="small" color={issue.level} label={issue.label} />) : <Chip size="small" color="success" label="ผ่านการตรวจเบื้องต้น" />}</Stack></Stack>
          {selectedItem.document_type === 'transfer_slip' && <Stack spacing={.75}><Divider /><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>ข้อมูลธุรกรรมสลิป</Typography><Typography variant="caption" color="text.secondary">ผู้โอน / ธนาคารต้นทาง / บัญชีต้นทาง</Typography><Typography>{[selectedItem.transfer_parties?.sender_name, selectedItem.transfer_parties?.sender_bank_name, selectedItem.transfer_parties?.sender_account_last4 ? `•••• ${selectedItem.transfer_parties.sender_account_last4}` : null].filter(Boolean).join(' · ') || 'ยังอ่านไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">ผู้รับ / ธนาคารปลายทาง / บัญชีปลายทาง</Typography><Typography>{[selectedItem.transfer_parties?.recipient_name, selectedItem.transfer_parties?.recipient_bank_name, selectedItem.transfer_parties?.recipient_account_last4 ? `•••• ${selectedItem.transfer_parties.recipient_account_last4}` : null].filter(Boolean).join(' · ') || 'ยังอ่านไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">วันเวลาโอน / เลขอ้างอิง / ความมั่นใจคู่โอน</Typography><Typography>{selectedItem.transfer_parties?.transfer_at ? new Date(selectedItem.transfer_parties.transfer_at).toLocaleString('th-TH') : 'ไม่ระบุ'} · {selectedItem.transfer_parties?.bank_reference ?? 'ไม่ระบุ'} · {selectedItem.transfer_parties?.payment_party_confidence == null ? '-' : `${(selectedItem.transfer_parties.payment_party_confidence * 100).toFixed(0)}%`}</Typography></Stack>}
          {selectedItem.document_type === 'cheque_payment' && <Stack spacing={.75}><Divider /><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>ข้อมูลเช็คสั่งจ่าย</Typography><Typography variant="caption" color="text.secondary">ผู้สั่งจ่าย / ผู้รับเงิน</Typography><Typography>{[selectedItem.cheque_evidence?.cheque_drawer_name, selectedItem.cheque_evidence?.cheque_payee_name].filter(Boolean).join(' → ') || 'ยังอ่านผู้สั่งจ่ายหรือผู้รับเงินไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">ธนาคาร / บัญชี / เลขที่เช็ค</Typography><Typography>{[selectedItem.cheque_evidence?.cheque_bank_name, selectedItem.cheque_evidence?.cheque_account_last4 ? `•••• ${selectedItem.cheque_evidence.cheque_account_last4}` : null, selectedItem.cheque_evidence?.cheque_number ? `เลขที่ ${selectedItem.cheque_evidence.cheque_number}` : null].filter(Boolean).join(' · ') || 'ยังอ่านข้อมูลเช็คไม่ได้'}</Typography><Typography variant="caption" color="text.secondary">วันที่ / ยอด / การจับคู่ / ความมั่นใจ</Typography><Typography>{selectedItem.cheque_evidence?.cheque_issued_on ? new Date(`${selectedItem.cheque_evidence.cheque_issued_on}T00:00:00`).toLocaleDateString('th-TH') : 'ไม่ระบุ'} · {selectedItem.cheque_evidence?.amount_total == null ? 'ไม่ระบุยอด' : `฿${selectedItem.cheque_evidence.amount_total.toLocaleString('th-TH')}`} · {selectedItem.cheque_evidence?.cheque_match_status === 'matched' ? `จับคู่แล้ว (${selectedItem.cheque_evidence.cheque_matched_entity_type ?? 'ทะเบียนกลาง'})` : selectedItem.cheque_evidence?.cheque_match_status === 'duplicate' ? 'รายการซ้ำ' : 'รอตรวจจับคู่'} · {selectedItem.cheque_evidence?.cheque_extraction_confidence == null ? '-' : `${(selectedItem.cheque_evidence.cheque_extraction_confidence * 100).toFixed(0)}%`}</Typography><Alert severity={selectedItem.cheque_evidence?.cheque_match_status === 'matched' ? 'success' : 'warning'}>{selectedItem.cheque_evidence?.cheque_match_status === 'duplicate' ? 'ระบบประทับรายการซ้ำแล้ว รายการนี้จะไม่ถูกส่งต่อ' : 'ตรวจชื่อผู้รับเงินกับทะเบียนกลางก่อนยืนยันผ่าน Intake'}</Alert></Stack>}
          <Button variant="outlined" onClick={() => void openSourcePreview(selectedItem)}>เปิดรูป/เอกสารต้นฉบับ</Button>
          {previewMessage && <Alert severity="info">{previewMessage}</Alert>}
          {previewFiles.length > 1 && <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{previewFiles.map((file, index) => <Button key={file.url} size="small" variant={index === previewIndex ? 'contained' : 'outlined'} onClick={() => setPreviewIndex(index)}>{file.label}</Button>)}</Stack>}
          {previewFiles[previewIndex] && <><Button size="small" component="a" href={previewFiles[previewIndex].url} target="_blank" rel="noreferrer" endIcon={<OpenInNewOutlined />}>เปิดในแท็บใหม่</Button>
            {previewFiles[previewIndex].contentType?.startsWith('image/') ? <Box component="img" src={previewFiles[previewIndex].url} alt="ไฟล์ต้นฉบับ" sx={{ width: '100%', maxHeight: 500, objectFit: 'contain', borderRadius: 1, bgcolor: 'grey.100' }} /> : <Box component="iframe" title="ไฟล์ต้นฉบับ" src={previewFiles[previewIndex].url} sx={{ width: '100%', height: 420, border: 0, borderRadius: 1 }} />}
          </>}
          <TextField label="หมายเหตุการดำเนินการ" multiline minRows={2} value={drawerNote} onChange={(event) => setDrawerNote(event.target.value)} />
          {selectedItem.source === 'document_flow' && <><Button variant="contained" disabled={actionLoading || selectedItem.current_flow !== 'intake' || (selectedItem.issue_codes?.length ?? 0) > 0 || selectedItem.state === 'duplicate_hold'} onClick={() => void workflowTransition(selectedItem, 'route_filter', drawerNote || 'ยืนยันผ่าน Intake และส่งเข้า Filter').then((ok) => { if (ok) setSelectedItem(null) })}>ยืนยันผ่าน Intake และส่งเข้า Filter</Button><Typography variant="caption" color="text.secondary">หากมีปัญหา คุณภาพต่ำ หรือเอกสารซ้ำ ต้องแก้หรือเลือกต้นฉบับก่อนจึงจะส่งต่อได้</Typography></>}
          {selectedItem.source === 'employee_intake' && <Button variant="contained" disabled={actionLoading || selectedItem.state !== 'pending_review'} onClick={() => void employeeIntakeTransition(selectedItem, 'approve').then((ok) => { if (ok) setSelectedItem(null) })}>อนุมัติส่งต่อ HR</Button>}
        </Stack>}
      </Drawer>
      </Paper>
    </Stack>
  )
}
