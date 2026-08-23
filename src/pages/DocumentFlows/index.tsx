import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined'
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined'
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined'
import ExpandMoreOutlinedIcon from '@mui/icons-material/ExpandMoreOutlined'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Badge, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { StandardDataTable, type StandardDataTableTools } from '../../components/StandardDataTable'
import { usePageTitle } from '../../hooks/usePageTitle'
import { userError } from '../../utils/userError'
import { IntakeRoomPanel, type IntakeRoomTableTools } from '../IntakeRoom'
import { useAuth } from '../../hooks/useAuth'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { documentFlowGateway, type DocumentFlowScope, type OmniFilterTaskRow, type TransferSlipParties } from '../../services/documentFlowGateway'

type Flow = 'intake' | 'filter' | 'posting'
type ViewMode = 'intake_room' | 'omni_filter' | 'hr_confirmation' | 'filter' | 'task_types'
type TaskCategory = 'accounting' | 'procurement' | 'inventory' | 'hr' | 'project' | 'reference'
type DestinationDepartment = 'all' | TaskCategory
type FlowItem = {
  id: string
  intake_id: string
  review_case_id: string | null
  source_message_id: string | null
  source_channel?: string | null
  source_room_name?: string | null
  source_sender_name?: string | null
  source_received_at?: string | null
  source_file_kind?: string | null
  source_attachment_count?: number | null
  accounting_document_id: string | null
  current_flow: Flow | 'completed'
  current_room: string
  state: string
  document_type: string | null
  route_target: string | null
  confidence: number | null
  auto_routed: boolean
  issue_codes: string[]
  vendor_name: string | null
  total_amount: number | null
  target_department?: string | null
  candidate_departments?: string[] | null
  assignment_status?: string | null
  sensitivity?: string | null
  classification_note?: string | null
  version: number
  last_error: string | null
  created_at: string
  updated_at: string
  projects: { name: string } | null
  project_id?: string | null
  work_package_id?: string | null
  data_review_status?: 'complete' | 'incomplete' | 'recheck_required' | 'rechecked'
  data_review_note?: string | null
  data_review_changed_fields?: string[] | null
  data_reviewed_at?: string | null
}
type FlowEvent = {
  id: string
  event_type: string
  from_flow: string | null
  to_flow: string | null
  from_state: string | null
  to_state: string | null
  note: string | null
  created_at: string
}
type QueueCursor = { updated_at: string; id: string }
type QueuePage = {
  items: FlowItem[]
  counts: { intake?: number; filter?: number; posting?: number }
  next_cursor: QueueCursor | null
}
type PreviewFile = { url: string; contentType: string | null; label: string }
type DestinationTask = { id: string; item_id: string; department: string; required: boolean; status: 'queued' | 'claimed' | 'completed' | 'returned' | 'cancelled' | 'recheck_required'; assigned_to: string | null; note: string | null; version: number; created_at: string; updated_at: string }
type ProjectOption = { id: string; name: string; code: string | null }
type WorkPackageOption = { id: string; project_id: string; parent_id: string | null; code: string | null; name: string; description: string | null; status: string }
type WorkPackageTreeNode = WorkPackageOption & { children: WorkPackageTreeNode[] }

const typeLabels: Record<string, string> = {
  transfer_slip: 'สลิปโอนเงิน',
  cheque_payment: 'เช็คสั่งจ่าย',
  quotation: 'ใบเสนอราคา', purchase_order: 'ใบสั่งซื้อ', goods_receipt: 'ใบรับสินค้า',
  delivery_note: 'ใบส่งสินค้า', billing_note: 'ใบวางบิล', invoice: 'ใบแจ้งหนี้',
  receipt: 'ใบเสร็จรับเงิน', cash_receipt: 'บิลเงินสด', tax_invoice_full: 'ใบกำกับภาษีเต็มรูป',
  tax_invoice_abbreviated: 'ใบกำกับภาษีอย่างย่อ', other: 'เอกสารอื่น', unreadable: 'อ่านไม่ได้',
}
const typeOrder = [
  'transfer_slip',
  'cheque_payment',
  'quotation',
  'purchase_order',
  'goods_receipt',
  'delivery_note',
  'billing_note',
  'invoice',
  'receipt',
  'cash_receipt',
  'tax_invoice_full',
  'tax_invoice_abbreviated',
  'other',
  'unreadable',
]
const typeOrderMap = new Map(typeOrder.map((type, index) => [type, index]))
const sortByTypeOrder = (a: string, b: string) => {
  const orderA = typeOrderMap.get(a)
  const orderB = typeOrderMap.get(b)
  if (orderA == null && orderB == null) return a.localeCompare(b, 'th')
  if (orderA == null) return 1
  if (orderB == null) return -1
  return orderA - orderB
}
const flowLabels: Record<string, string> = { intake: 'Intake', filter: 'Filter', posting: 'Posting', completed: 'เสร็จสิ้น' }
const departmentLabels: Record<string, string> = { accounting: 'บัญชี', procurement: 'จัดซื้อ', inventory: 'สต็อก/รับสินค้า', hr: 'HR', project: 'โครงการ', reference: 'เอกสารอ้างอิง', admin: 'Admin' }
const omniConversationLabels: Record<string, string> = { document: 'เอกสาร', hr: 'HR', accounting: 'บัญชี', project: 'โครงการ', procurement: 'จัดซื้อ', inventory: 'สต็อก', system_error: 'ปัญหาระบบ', question: 'คำถาม', context: 'บริบท', unknown: 'รอคัดแยก' }
const omniDedupeLabels: Record<string, string> = { primary: 'ต้นฉบับหลัก', duplicate: 'ซ้ำ', possible_duplicate: 'อาจซ้ำ', context: 'บริบท' }
const omniTaskStatusLabels: Record<string, string> = { queued: 'รอคัดแยก', claimed: 'มีผู้รับงาน', in_progress: 'กำลังทำ', completed: 'เสร็จแล้ว', returned: 'ส่งกลับ', dismissed: 'ไม่นำมาใช้' }
const actionLabels: Record<string, string> = {
  route_filter: 'ส่งเข้า Filter', request_classification: 'ส่งกลับคัดแยก', request_correction: 'ส่งกลับแก้ไข',
  ready_posting: 'ส่งเข้า Posting', approve: 'อนุมัติเข้าคิว Gateway', reject: 'ไม่อนุมัติ', retry: 'ลองใหม่',
}
const stateLabels: Record<string, string> = {
  received: 'รับเข้าแล้ว', ai_processing: 'AI กำลังวิเคราะห์', awaiting_classification: 'รอคัดแยก',
  validating: 'กำลังตรวจละเอียด', needs_correction: 'รอแก้ไข', duplicate_hold: 'พักเอกสารซ้ำ',
  ready_for_posting: 'พร้อมส่ง Posting', destination_in_progress: 'กำลังดำเนินงานปลายทาง', awaiting_approval: 'รออนุมัติ',
  approved_waiting_gateway: 'อนุมัติแล้ว—รอ Gateway', posting: 'กำลังบันทึกปลายทาง', posted: 'บันทึกแล้ว',
  rejected: 'ไม่อนุมัติ', failed: 'ทำงานไม่สำเร็จ', dismissed: 'ไม่นำมาใช้',
}
const dataReviewLabels = { complete: 'ข้อมูลครบถ้วน', incomplete: 'ข้อมูลไม่ครบ', recheck_required: 'แก้ไขแล้ว · รอตรวจซ้ำ', rechecked: 'ตรวจซ้ำผ่าน' } as const
const dataReviewColor = (status?: FlowItem['data_review_status']) => status === 'incomplete' ? 'error' : status === 'recheck_required' ? 'warning' : status === 'rechecked' ? 'info' : 'success'
const nextActionLabel = (item: FlowItem) => {
  const action = availableActions(item)[0]
  return action ? actionLabels[action] : item.state === 'posted' || item.state === 'completed' ? 'ปิดงานแล้ว' : 'ติดตามสถานะ'
}
const latestComment = (item: FlowItem) => item.data_review_note ?? item.classification_note ?? item.last_error ?? '-'

const money = (value: number | null) => value == null ? '-' : new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value)
const confidence = (value: number | null) => value == null ? '-' : `${(value * 100).toFixed(1)}%`
const roomLabel = (room: string) => room.replaceAll('_', ' ')
const routeTargetLabel = (routeTarget: string | null) => routeTarget ? routeTarget.replaceAll('_', ' ') : '-'
const maskedAccount = (last4: string | null) => last4 ? `•••• ${last4}` : 'ยังไม่ระบุ'
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : 'ยังไม่ระบุ'
const bangkokToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())

const workPackageSaveMessage = (reason: unknown, action: 'create' | 'assign') => {
  const raw = userError(reason).toLowerCase()
  if (raw.includes('work_package_name_required')) return 'กรอกชื่องานย่อยก่อนบันทึก'
  if (raw.includes('work_package_duplicate_name')) return 'มีชื่องานย่อยนี้อยู่แล้วใต้โครงการ/งานแม่เดียวกัน ให้เลือกรายการเดิมแทน'
  if (raw.includes('work_package_permission_denied')) return 'บัญชีนี้ไม่มีสิทธิ์เพิ่มงานย่อย ต้องใช้ผู้ดูแลระบบหรือผู้จัดการบริษัท'
  if (raw.includes('project_not_found_or_denied') || raw.includes('workflow_project_mismatch')) return 'โครงการที่เลือกไม่อยู่ในบริษัทเดียวกับเอกสาร หรือคุณไม่มีสิทธิ์ใช้งานโครงการนี้'
  if (raw.includes('work_package_parent_mismatch') || raw.includes('workflow_work_package_mismatch')) return 'งานย่อยที่เลือกไม่ได้อยู่ใต้โครงการเดียวกัน ให้เลือกโครงการและงานย่อยใหม่'
  if (raw.includes('workflow_version_conflict')) return 'รายการนี้ถูกแก้ไขโดยผู้อื่นแล้ว กรุณารีเฟรชข้อมูลและบันทึกอีกครั้ง'
  if (raw.includes('workflow_item_not_found_or_denied') || raw.includes('workflow_permission_denied')) return 'คุณไม่มีสิทธิ์แก้ไขเอกสารนี้ในบริษัทปัจจุบัน'
  return `${action === 'create' ? 'เพิ่มงานย่อย' : 'บันทึกโครงการ/งานย่อย'}ไม่สำเร็จ: ${userError(reason)}`
}

function availableActions(item: FlowItem) {
  if (item.state === 'failed' || item.state === 'rejected') return ['retry']
  if (item.current_flow === 'intake') return ['route_filter']
  if (item.current_flow === 'filter') return item.accounting_document_id
    ? ['ready_posting', 'request_correction', 'reject'] : ['request_correction', 'reject']
  if (item.current_flow === 'posting' && item.state === 'awaiting_approval') return ['approve', 'request_correction', 'reject']
  return []
}

function departmentsFor(item: FlowItem): TaskCategory[] {
  const candidates = (item.candidate_departments ?? []).filter((department): department is TaskCategory => department in departmentLabels && department !== 'admin')
  if (candidates.length) return [...new Set(candidates)]
  const department = item.target_department ?? ''
  if (department === 'accounting') return ['accounting']
  if (department === 'procurement') return ['procurement']
  if (department === 'inventory') return ['inventory']
  if (department === 'hr') return ['hr']
  if (department === 'project') return ['project']
  const route = item.route_target ?? ''
  if (route.includes('accounts_payable') || route.includes('billing')) return ['accounting']
  if (route.includes('procurement') || route.includes('purchase_order')) return ['procurement']
  if (route.includes('goods_receipt') || route.includes('stock')) return ['inventory']
  if (route.includes('hr')) return ['hr']
  if (route.includes('project')) return ['project']
  return ['reference']
}

function taskCategoryOf(item: FlowItem): TaskCategory {
  return departmentsFor(item)[0] ?? 'reference'
}

export function DocumentFlowsPage() {
  const { profile, currentCompany } = useAuth()
  usePageTitle('Document Flow Center')
  const [searchParams, setSearchParams] = useSearchParams()
  const initialDocumentView = searchParams.get('document_view') as ViewMode | null
  const initialQueueView: Exclude<ViewMode, 'omni_filter'> = initialDocumentView === 'filter' || initialDocumentView === 'task_types' ? initialDocumentView : 'intake_room'
  const [flow, setFlow] = useState<ViewMode>(initialDocumentView === 'omni_filter' || initialDocumentView === 'hr_confirmation' ? initialDocumentView : initialQueueView)
  const [queueView, setQueueView] = useState<Exclude<ViewMode, 'omni_filter'>>(initialQueueView)
  const [globalScope, setGlobalScope] = useState<DocumentFlowScope>(() => ({
    channel: (searchParams.get('channel') as DocumentFlowScope['channel']) || 'all',
    // Intake is the entry point and can grow continuously.  Start with the
    // Bangkok business day unless a shared URL explicitly defines a date.
    date: searchParams.get('received_date') || bangkokToday(),
    room: searchParams.get('source_room') || '',
    sender: searchParams.get('source_sender') || '',
    fileKind: (searchParams.get('file_kind') as DocumentFlowScope['fileKind']) || 'all',
    project: searchParams.get('project') || '',
    localTestData: searchParams.get('local_test_data') === '1',
  }))
  const [items, setItems] = useState<FlowItem[]>([])
  const [omniTasks, setOmniTasks] = useState<OmniFilterTaskRow[]>([])
  const [counts, setCounts] = useState({ intake: 0, omniFilter: 0, filter: 0, taskTypes: 0 })
  const [nextCursor, setNextCursor] = useState<QueueCursor | null>(null)
  const [status, setStatus] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [destinationDepartment, setDestinationDepartment] = useState<DestinationDepartment>('all')
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [timelineItem, setTimelineItem] = useState<FlowItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<FlowItem | null>(null)
  const [routeDepartment, setRouteDepartment] = useState('admin')
  const [routeCandidates, setRouteCandidates] = useState<string[]>([])
  const [routeDepartments, setRouteDepartments] = useState<string[]>([])
  const [requiredDepartments, setRequiredDepartments] = useState<string[]>([])
  const [destinationTasks, setDestinationTasks] = useState<DestinationTask[]>([])
  const [routeDocumentType, setRouteDocumentType] = useState('other')
  const [routeNote, setRouteNote] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [workPackages, setWorkPackages] = useState<WorkPackageOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState('')
  const [newWorkPackageName, setNewWorkPackageName] = useState('')
  const [newWorkPackageDetail, setNewWorkPackageDetail] = useState('')
  const [previewMessage, setPreviewMessage] = useState('')
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [transferSlipParties, setTransferSlipParties] = useState<TransferSlipParties | null>(null)
  const [transferSlipPartiesMessage, setTransferSlipPartiesMessage] = useState('')
  const [events, setEvents] = useState<FlowEvent[]>([])
  const [globalFilterOpen, setGlobalFilterOpen] = useState(false)
  const intakeTableToolsRef = useRef<IntakeRoomTableTools | null>(null)
  const flowTableToolsRef = useRef<StandardDataTableTools | null>(null)
  const previewRequestRef = useRef(0)
  const today = bangkokToday()
  const isDefaultTodayScope = globalScope.date === today

  const updateGlobalScope = useCallback((updates: Partial<DocumentFlowScope>) => {
    setGlobalScope((current) => ({ ...current, ...updates }))
  }, [])

  const clearGlobalScope = useCallback(() => {
    setGlobalScope((current) => ({ channel: 'all', date: '', room: '', sender: '', fileKind: 'all', project: '', localTestData: current.localTestData }))
  }, [])

  const selectTodayScope = useCallback(() => {
    setGlobalScope((current) => ({ ...current, date: bangkokToday() }))
  }, [])

  const activeGlobalFilterCount = useMemo(() => [
    globalScope.channel !== 'all', Boolean(globalScope.date) && !isDefaultTodayScope, Boolean(globalScope.room), Boolean(globalScope.sender), globalScope.fileKind !== 'all', Boolean(globalScope.project),
  ].filter(Boolean).length, [globalScope, isDefaultTodayScope])
  const activeGlobalFilterLabels = useMemo(() => [
    globalScope.channel !== 'all' ? `ช่องทาง: ${globalScope.channel}` : null,
    globalScope.date && !isDefaultTodayScope ? `วันที่รับเข้า: ${globalScope.date}` : null,
    globalScope.room ? `ห้อง: ${globalScope.room}` : null,
    globalScope.sender ? `ผู้ส่ง: ${globalScope.sender}` : null,
    globalScope.fileKind !== 'all' ? `ชนิดไฟล์: ${globalScope.fileKind}` : null,
    globalScope.project ? `โครงการ: ${globalScope.project}` : null,
  ].filter((value): value is string => Boolean(value)), [globalScope, isDefaultTodayScope])
  const hrGateSummary = useMemo(() => {
    const result = { candidate: 0, system: 0, duplicate: 0, low_confidence: 0 }
    for (const row of omniTasks) { const gate = row.omni_intake_sources?.hr_bundle?.gate; if (gate) result[gate] += 1 }
    return result
  }, [omniTasks])
  const setVisibleIntakeCount = useCallback((count: number) => setCounts((current) => current.intake === count ? current : { ...current, intake: count }), [])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    const values: Array<[string, string | undefined]> = [
      ['document_view', flow],
      ['channel', globalScope.channel !== 'all' ? globalScope.channel : undefined],
      ['received_date', globalScope.date || undefined],
      ['source_room', globalScope.room?.trim() || undefined],
      ['source_sender', globalScope.sender?.trim() || undefined],
      ['file_kind', globalScope.fileKind !== 'all' ? globalScope.fileKind : undefined],
      ['project', globalScope.project?.trim() || undefined],
      ['local_test_data', globalScope.localTestData ? '1' : undefined],
    ]
    values.forEach(([key, value]) => { if (value) next.set(key, value); else next.delete(key) })
    setSearchParams(next, { replace: true })
  // The central view and global scope own these query keys; local Intake filters remain intact.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, globalScope, setSearchParams])

  /* Legacy bulk loader retained in comments only as a migration reference.
  const loadLegacy = useCallback(async () => {
    setLoading(true)
    setError('')
    const { items: response, intake: intakeCountResponse, filter: filterCountResponse, posting: taskCountResponse, hr: hrCountResponse } = await documentFlowGateway.loadCenter()
    if (response.error) setError(`โหลด Workflow Ledger ไม่สำเร็จ: ${userError(response.error)}`)
    if (intakeCountResponse.error || filterCountResponse.error || taskCountResponse.error || hrCountResponse.error) setError('โหลดจำนวนคิวศูนย์เอกสารไม่สำเร็จ')
    const flowItems = (response.data ?? []) as unknown as FlowItem[]
    setItems(flowItems)
    setCounts({
      intake: (intakeCountResponse.count ?? flowItems.length) + (hrCountResponse.count ?? 0),
      filter: filterCountResponse.count ?? flowItems.filter((item) => item.current_flow === 'filter').length,
      taskTypes: taskCountResponse.count ?? flowItems.filter((item) => item.current_flow === 'posting').length,
    })
    setLoading(false)
  }, [])
  */

  const load = useCallback(async (cursor: QueueCursor | null = null, append = false) => {
    setLoading(true)
    setError('')
    if (flow === 'omni_filter' || flow === 'hr_confirmation') {
      const response = await documentFlowGateway.loadOmniFilterTasks(flow === 'hr_confirmation' ? { ...globalScope, conversationType: 'hr_confirmation' } : globalScope)
      if (response.error) {
        setError(`โหลด Omni Filter ไม่สำเร็จ: ${userError(response.error)}`)
        setLoading(false)
        return
      }
      const rows = (response.data ?? []) as unknown as OmniFilterTaskRow[]
      setOmniTasks(rows)
      setItems([])
      setCounts((current) => ({ ...current, omniFilter: response.count ?? rows.length }))
      setNextCursor(null)
      setLoading(false)
      return
    }
    const response = await documentFlowGateway.loadQueuePage(
      cursor ? { updatedAt: cursor.updated_at, id: cursor.id } : null,
      100,
      flow === 'filter' ? 'filter' : flow === 'task_types' ? 'posting' : null,
      globalScope,
    )
    if (response.error) {
      setError(userError(response.error))
      setLoading(false)
      return
    }
    const page = (response.data ?? { items: [], counts: {}, next_cursor: null }) as unknown as QueuePage
    let flowItems = page.items ?? []
    let finalCursor = page.next_cursor ?? null
    // Counts and table rows must be derived from the same complete scope.  A
    // single 100-row page previously made a tab show a real count but an empty
    // local category when its rows were on a later page.
    if (!append) {
      while (finalCursor && flowItems.length < 2000) {
        const nextResponse = await documentFlowGateway.loadQueuePage(
          { updatedAt: finalCursor.updated_at, id: finalCursor.id }, 100,
          flow === 'filter' ? 'filter' : flow === 'task_types' ? 'posting' : null,
          globalScope,
        )
        if (nextResponse.error) { setError(`โหลดรายการหน้าถัดไปไม่สำเร็จ: ${userError(nextResponse.error)}`); break }
        const nextPage = (nextResponse.data ?? { items: [], next_cursor: null }) as unknown as QueuePage
        flowItems = [...flowItems, ...(nextPage.items ?? []).filter((item) => !flowItems.some((loaded) => loaded.id === item.id))]
        finalCursor = nextPage.next_cursor ?? null
      }
    }
    setItems((current) => append ? [...current, ...flowItems.filter((item) => !current.some((loaded) => loaded.id === item.id))] : flowItems)
    setOmniTasks([])
    setCounts((current) => ({
      intake: page.counts?.intake ?? flowItems.length,
      omniFilter: current.omniFilter,
      filter: page.counts?.filter ?? flowItems.filter((item) => item.current_flow === 'filter').length,
      taskTypes: page.counts?.posting ?? flowItems.filter((item) => item.current_flow === 'posting').length,
    }))
    setNextCursor(finalCursor)
    setLoading(false)
  }, [flow, globalScope])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const loadProjectOptions = useCallback(async () => {
    const [projectResponse, packageResponse] = await documentFlowGateway.loadProjectWorkPackages()
    if (projectResponse.error || packageResponse.error) {
      setError(`โหลดโครงการ/งานย่อยไม่สำเร็จ: ${userError(projectResponse.error ?? packageResponse.error)}`)
      return
    }
    setProjects((projectResponse.data ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      code: project.code,
    })) as ProjectOption[])
    setWorkPackages((packageResponse.data ?? []) as WorkPackageOption[])
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadProjectOptions() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadProjectOptions])

  const selectedWorkPackages = useMemo(() => {
    const byId = new Map(workPackages.filter((item) => item.project_id === selectedProjectId).map((item) => [item.id, item]))
    const labelFor = (item: WorkPackageOption, trail = new Set<string>()): string => {
      if (trail.has(item.id)) return item.name
      const parent = item.parent_id ? byId.get(item.parent_id) : null
      return parent ? `${labelFor(parent, new Set([...trail, item.id]))} › ${item.name}` : item.name
    }
    return [...byId.values()].map((item) => ({ ...item, label: `${item.code ? `${item.code} · ` : ''}${labelFor(item)}` })).sort((a, b) => a.label.localeCompare(b.label, 'th'))
  }, [selectedProjectId, workPackages])

  const selectedWorkPackageTree = useMemo<WorkPackageTreeNode[]>(() => {
    const nodes = new Map(selectedWorkPackages.map((item) => [item.id, { ...item, children: [] as WorkPackageTreeNode[] }]))
    const roots: WorkPackageTreeNode[] = []
    nodes.forEach((node) => {
      const parent = node.parent_id ? nodes.get(node.parent_id) : null
      if (parent) parent.children.push(node)
      else roots.push(node)
    })
    const sortNodes = (items: WorkPackageTreeNode[]) => items.sort((a, b) => a.name.localeCompare(b.name, 'th')).forEach((item) => sortNodes(item.children))
    sortNodes(roots)
    return roots
  }, [selectedWorkPackages])

  const renderWorkPackageNode = (node: WorkPackageTreeNode, depth = 0): ReactNode => <Box key={node.id} sx={{ ml: depth ? 1.25 : 0, pl: depth ? 1.25 : 0, borderLeft: depth ? 1 : 0, borderColor: 'divider', mt: .5 }}>
    <Button size="small" variant={selectedWorkPackageId === node.id ? 'contained' : 'text'} onClick={() => setSelectedWorkPackageId(node.id)} sx={{ textTransform: 'none', justifyContent: 'flex-start', textAlign: 'left', maxWidth: '100%' }}>
      {node.code ? `${node.code} · ` : ''}{node.name}{node.children.length ? ` (${node.children.length})` : ''}
    </Button>
    {node.children.map((child) => renderWorkPackageNode(child, depth + 1))}
  </Box>

  const openTimeline = async (item: FlowItem) => {
    setTimelineItem(item)
    setEvents([])
    const response = await documentFlowGateway.loadTimeline(item.id)
    if (response.error) setError(`โหลด Timeline ไม่สำเร็จ: ${userError(response.error)}`)
    else setEvents((response.data ?? []) as FlowEvent[])
  }

  const openPreview = async (item: FlowItem) => {
    const requestId = ++previewRequestRef.current
    setPreviewMessage('กำลังเปิดไฟล์ต้นฉบับ…')
    setPreviewFiles([])
    setPreviewIndex(0)
    try {
      const result = await documentFlowGateway.preview(item.id)
      if (requestId !== previewRequestRef.current) return
      if (result.error) { setPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(result.error)}`); return }
      const data = result.data as { available?: boolean; reason?: string; files?: { bucket: string; path: string; content_type?: string | null }[] } | null
      if (!data?.files?.length) { setPreviewMessage(data?.reason ?? 'ไม่พบไฟล์ต้นฉบับ'); return }
      const signedFiles = await Promise.all(data.files.map(async (file, index) => {
        const signed = await documentFlowGateway.signedPreviewUrl(file.bucket, file.path)
        return signed.data?.signedUrl ? { url: signed.data.signedUrl, contentType: file.content_type ?? null, label: `ไฟล์ ${index + 1}` } : null
      }))
      const available = signedFiles.filter((file): file is PreviewFile => Boolean(file))
      if (requestId !== previewRequestRef.current) return
      if (!available.length) { setPreviewMessage('สร้างลิงก์เปิดไฟล์ไม่สำเร็จ กรุณาลองใหม่หรือแจ้งผู้ดูแลระบบ'); return }
      setPreviewFiles(available)
      setPreviewMessage('')
    } catch (previewError) {
      if (requestId !== previewRequestRef.current) return
      setPreviewMessage(`เปิดไฟล์ไม่ได้: ${userError(previewError)}`)
    }
  }

  const transition = async (item: FlowItem, action: string) => {
    const request = {
      item_id: item.id,
      action,
      expected_version: item.version,
    }
    setWorkingId(item.id)
    setError('')
    setSuccess('')
    const errorNote = (error: unknown) => {
      const message = userError(error)
      if (message.includes('workflow_version_conflict')) return 'ข้อมูลรายการนี้เปลี่ยนจากอีกหน้าจอแล้ว กรุณารีเฟรชก่อนทำรายการใหม่'
      if (message.includes('workflow_document_not_confirmed')) return 'เอกสารยังไม่ผ่านการยืนยันรายละเอียด จึงยังส่งเข้า Posting ไม่ได้'
      if (message.includes('workflow_transition_not_allowed')) return 'สถานะปัจจุบันไม่อนุญาตให้ทำคำสั่งนี้ กรุณารีเฟรชและตรวจ Timeline'
      return message
    }
    try {
      await runWithMutationAttempt({
        module: 'document-flows',
        action: `transition:${action}`,
        actorProfileId: profile?.id,
        companyId: currentCompany?.company_id,
        request,
        operation: async () => await documentFlowGateway.transition({
          itemId: item.id,
          action,
          expectedVersion: item.version,
          eventKey: crypto.randomUUID(),
        }),
        errorAction: 'เปลี่ยนสถานะไม่สำเร็จ',
        errorCode: 'UNHANDLED',
      })
      setSuccess(`${actionLabels[action] ?? action} เรียบร้อย ระบบบันทึก Timeline และป้องกันคำสั่งซ้ำแล้ว`)
      await load()
    } catch (error) {
      const friendly = await errorNote(error)
      setError(`เปลี่ยนสถานะไม่สำเร็จ: ${friendly}`)
    } finally {
      setWorkingId('')
    }
  }

  const routeItem = async (action: 'classify_and_route' | 'claim_destination' | 'return_to_filter' | 'return_to_intake' | 'reassign_destination') => {
    if (!selectedItem) return
    if (['return_to_filter', 'return_to_intake', 'reassign_destination'].includes(action) && !routeNote.trim()) {
      setError('กรุณาระบุเหตุผลก่อนส่งกลับหรือเปลี่ยนปลายทาง')
      return
    }
    setWorkingId(selectedItem.id)
    setError('')
    try {
      const result = await documentFlowGateway.route({
        itemId: selectedItem.id, action, expectedVersion: selectedItem.version, eventKey: crypto.randomUUID(),
        note: routeNote.trim() || null,
        documentType: action === 'classify_and_route' ? routeDocumentType : null,
        department: routeDepartment,
        candidates: action === 'classify_and_route' || action === 'reassign_destination'
          ? (routeCandidates.length ? routeCandidates : [routeDepartment]) : null,
      })
      if (result.error) throw result.error
      setSuccess(action === 'claim_destination' ? 'รับงานเข้าคิวแผนกแล้ว' : action.startsWith('return') ? 'ส่งรายการกลับพร้อมบันทึกเหตุผลแล้ว' : 'บันทึกการคัดแยกและส่งต่อเรียบร้อยแล้ว')
      setSelectedItem(null)
      await load()
    } catch (routeError) {
      setError(`ทำรายการไม่สำเร็จ: ${userError(routeError)}`)
    } finally { setWorkingId('') }
  }

  const loadDestinationTasks = async (itemId: string) => {
    const result = await documentFlowGateway.loadDestinationTasks(itemId)
    if (result.error) { setError(`โหลดงานปลายทางไม่สำเร็จ: ${userError(result.error)}`); return }
    setDestinationTasks((result.data ?? []) as DestinationTask[])
  }

  const routeMultiDestination = async () => {
    if (!selectedItem || routeDepartments.length === 0) { setError('กรุณาเลือกอย่างน้อยหนึ่งแผนกปลายทาง'); return }
    setWorkingId(selectedItem.id); setError('')
    try {
      const result = await documentFlowGateway.routeMultiDestination({ itemId: selectedItem.id, expectedVersion: selectedItem.version, eventKey: crypto.randomUUID(), documentType: routeDocumentType, departments: routeDepartments, requiredDepartments, note: routeNote.trim() || null })
      if (result.error) throw result.error
      const updated = result.data as unknown as FlowItem
      setSelectedItem(updated)
      setSuccess(`สร้างงานปลายทาง ${routeDepartments.length} แผนกแล้ว โดยไม่สร้างเอกสารซ้ำ`)
      await loadDestinationTasks(updated.id)
      await load()
    } catch (routeError) { setError(`ส่งงานหลายปลายทางไม่สำเร็จ: ${userError(routeError)}`) } finally { setWorkingId('') }
  }

  const updateDestinationTask = async (task: DestinationTask, action: 'claim' | 'complete' | 'return') => {
    setWorkingId(task.id); setError('')
    try {
      const result = await documentFlowGateway.updateDestinationTask({ taskId: task.id, expectedVersion: task.version, action, eventKey: crypto.randomUUID(), note: action === 'return' ? routeNote.trim() : null })
      if (result.error) throw result.error
      setSuccess(action === 'complete' ? 'ปิดงานย่อยแล้ว ระบบตรวจเงื่อนไขงานบังคับให้อัตโนมัติ' : action === 'claim' ? 'รับงานย่อยแล้ว' : 'ส่งงานย่อยกลับ Filter แล้ว')
      if (selectedItem) await loadDestinationTasks(selectedItem.id)
      await load()
    } catch (taskError) { setError(`ทำรายการงานปลายทางไม่สำเร็จ: ${userError(taskError)}`) } finally { setWorkingId('') }
  }

  const markDataReview = async (status: 'incomplete' | 'recheck_required') => {
    if (!selectedItem) return
    if (!routeNote.trim()) { setError('กรุณาระบุสิ่งที่แก้ไขหรือข้อมูลที่ไม่ครบ'); return }
    setWorkingId(selectedItem.id); setError('')
    try {
      const result = await documentFlowGateway.markDataReview({ itemId: selectedItem.id, expectedVersion: selectedItem.version, eventKey: crypto.randomUUID(), status, departments: routeDepartments, note: routeNote.trim(), changedFields: [] })
      if (result.error) throw result.error
      setSelectedItem(result.data as unknown as FlowItem)
      setSuccess(status === 'incomplete' ? 'บันทึกข้อมูลไม่ครบและส่งกลับ Filter แล้ว' : 'บันทึกการแก้ไขแล้ว เปิดตรวจซ้ำเฉพาะแผนกที่เลือก')
      await load()
    } catch (reviewError) { setError(`บันทึกสถานะข้อมูลไม่สำเร็จ: ${userError(reviewError)}`) } finally { setWorkingId('') }
  }

  const assignProjectWorkPackage = async () => {
    if (!selectedItem || !selectedProjectId) {
      setError('กรุณาเลือกโครงการหลักก่อนบันทึก')
      return
    }
    setWorkingId(selectedItem.id)
    setError('')
    try {
      const result = await documentFlowGateway.assignProjectWorkPackage({
        itemId: selectedItem.id,
        projectId: selectedProjectId,
        workPackageId: selectedWorkPackageId || null,
        expectedVersion: selectedItem.version,
        eventKey: crypto.randomUUID(),
      })
      if (result.error) throw result.error
      const updated = result.data as unknown as FlowItem
      setSelectedItem(updated)
      setSuccess('ผูกโครงการและงานย่อยแล้ว พร้อมบันทึก Timeline')
      await load()
    } catch (assignmentError) {
      setError(workPackageSaveMessage(assignmentError, 'assign'))
    } finally { setWorkingId('') }
  }

  const createWorkPackage = async () => {
    if (!selectedProjectId || !newWorkPackageName.trim()) {
      setError('กรุณาเลือกโครงการหลักและกรอกชื่องานย่อย')
      return
    }
    setWorkingId(selectedItem?.id ?? 'new-work-package')
    setError('')
    try {
      const result = await documentFlowGateway.createProjectWorkPackage({
        projectId: selectedProjectId,
        parentId: selectedWorkPackageId || null,
        name: newWorkPackageName.trim(),
        description: newWorkPackageDetail.trim() || undefined,
      })
      if (result.error) throw result.error
      const created = result.data as unknown as WorkPackageOption
      setWorkPackages((current) => [...current, created])
      setSelectedWorkPackageId(created.id)
      setNewWorkPackageName('')
      setNewWorkPackageDetail('')
      setSuccess('เพิ่มงานย่อยแล้ว เลือกรายการนี้ไว้ให้เรียบร้อย')
    } catch (createError) {
      setError(workPackageSaveMessage(createError, 'create'))
    } finally { setWorkingId('') }
  }

  const rows = useMemo(() => {
    if (flow === 'filter') return items.filter((item) => item.current_flow === 'filter')
    if (flow === 'task_types') return items.filter((item) => item.current_flow === 'posting')
    return []
  }, [flow, items])
  const destinationCounts = useMemo(() => {
    const counts = { all: rows.length } as Record<DestinationDepartment, number>
    for (const department of Object.keys(departmentLabels).filter((value) => value !== 'admin') as TaskCategory[]) {
      counts[department] = rows.filter((row) => departmentsFor(row).includes(department)).length
    }
    return counts
  }, [rows])
  const statuses = Array.from(new Set(rows.map((row) => row.state))).sort()
  const typeOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.document_type ?? 'other')).values()).sort((a, b) => sortByTypeOrder(a, b)),
    [rows],
  )
  const normalizedTypeFilter = useMemo(() => {
    if (typeFilter === 'all') return 'all'
    return typeOptions.includes(typeFilter) ? typeFilter : 'all'
  }, [typeFilter, typeOptions])
  const visible = useMemo(() => {
    const byType = normalizedTypeFilter === 'all' ? rows : rows.filter((row) => (row.document_type ?? 'other') === normalizedTypeFilter)
    const byDepartment = flow === 'task_types' && destinationDepartment !== 'all'
      ? byType.filter((row) => departmentsFor(row).includes(destinationDepartment))
      : byType
    return status === 'all' ? byDepartment : byDepartment.filter((row) => row.state === status)
  }, [destinationDepartment, flow, normalizedTypeFilter, rows, status])
  const activePreview = previewFiles[previewIndex] ?? null

  const loadTransferSlipParties = useCallback(async (item: FlowItem) => {
    setTransferSlipParties(null)
    setTransferSlipPartiesMessage('')
    if (item.document_type !== 'transfer_slip') return
    if (!item.source_message_id) {
      setTransferSlipPartiesMessage('ไม่พบรหัสต้นทางของสลิป จึงไม่สามารถอ่านข้อมูลธุรกรรมจากทะเบียนกลางได้')
      return
    }
    setTransferSlipPartiesMessage('กำลังโหลดข้อมูลธุรกรรมสลิปจากทะเบียนกลาง…')
    const response = await documentFlowGateway.loadTransferSlipParties([item.source_message_id])
    if (response.error) {
      setTransferSlipPartiesMessage(`โหลดข้อมูลธุรกรรมสลิปไม่สำเร็จ: ${userError(response.error)}`)
      return
    }
    const parties = response.data.find((entry) => entry.source_message_id === item.source_message_id) ?? null
    setTransferSlipParties(parties)
    setTransferSlipPartiesMessage(parties ? '' : 'สลิปนี้ยังไม่มีรายละเอียดผู้โอน/ผู้รับในทะเบียนกลาง')
  }, [])

  return <Stack spacing={2.5}>
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 28 }}>
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="ตัวกรองกลาง"><IconButton size="small" color={activeGlobalFilterCount ? 'primary' : 'default'} onClick={() => setGlobalFilterOpen(true)}><Badge color="primary" badgeContent={activeGlobalFilterCount} invisible={activeGlobalFilterCount === 0}><FilterAltOutlinedIcon fontSize="small" /></Badge></IconButton></Tooltip>
        <Tooltip title="รีเฟรช"><span><IconButton size="small" color="primary" disabled={loading} onClick={() => { void load(); if (flow === 'intake_room') void intakeTableToolsRef.current?.refresh() }}><RefreshOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="ตั้งค่าคอลัมน์ที่แสดง"><span><IconButton size="small" onClick={(event) => (flow === 'intake_room' ? intakeTableToolsRef.current : flowTableToolsRef.current)?.openColumnSettings(event.currentTarget)}><SettingsOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Export CSV"><span><IconButton size="small" onClick={() => (flow === 'intake_room' ? intakeTableToolsRef.current : flowTableToolsRef.current)?.exportCsv()}><DownloadOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Export PDF"><span><IconButton size="small" onClick={() => (flow === 'intake_room' ? intakeTableToolsRef.current : flowTableToolsRef.current)?.exportPdf()}><PictureAsPdfOutlinedIcon fontSize="small" /></IconButton></span></Tooltip>
      </Stack>
    </Box>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {success && <Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert>}
    <Paper variant="outlined">
      <Stack sx={{ px: 1 }}>
        <Tabs value={flow === 'omni_filter' || flow === 'hr_confirmation' ? 'omni_filter' : 'documents'} onChange={(_event, value) => { if (value === 'omni_filter') setFlow('omni_filter'); else setFlow(queueView); setStatus('all'); setTypeFilter('all'); setDestinationDepartment('all') }} variant="scrollable">
          <Tab value="documents" label={`คิวเอกสาร (${flow === 'filter' ? counts.filter : flow === 'task_types' ? counts.taskTypes : counts.intake})`} />
          <Tab value="omni_filter" label={`ข้อความและบริบท (${counts.omniFilter})`} />
        </Tabs>
      </Stack>
    </Paper>
    {flow === 'task_types' && <Stack direction="row" sx={{ alignItems: 'center', px: .5, flexWrap: 'wrap', gap: 1 }}>
      <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 240 } }}>
        <InputLabel>แผนกปลายทาง</InputLabel>
        <Select label="แผนกปลายทาง" value={destinationDepartment} onChange={(event) => setDestinationDepartment(event.target.value as DestinationDepartment)}>
          <MenuItem value="all">ทุกแผนก ({destinationCounts.all})</MenuItem>
          {(Object.keys(departmentLabels).filter((value) => value !== 'admin') as TaskCategory[]).map((department) => <MenuItem key={department} value={department}>{departmentLabels[department]} ({destinationCounts[department]})</MenuItem>)}
        </Select>
      </FormControl>
    </Stack>}
    {globalScope.localTestData && <Alert severity="info" action={<Stack direction="row" spacing={.5}><Button size="small" onClick={() => { void load() }}>Reload</Button><Button size="small" onClick={clearGlobalScope}>Reset</Button></Stack>}>LOCAL TEST DATA · วันที่ 22–23/8/2569 · 9 รายการ · ไม่ใช่ข้อมูล Production</Alert>}
    {activeGlobalFilterCount > 0 && <Stack direction="row" spacing={1} sx={{ alignItems: 'center', px: .5, flexWrap: 'wrap' }}>{activeGlobalFilterLabels.map((label) => <Chip key={label} size="small" color="primary" label={label} onClick={() => setGlobalFilterOpen(true)} />)}<Typography variant="caption" color="text.secondary">ผลลัพธ์นับจากตัวกรองเดียวกับตาราง</Typography><Button size="small" onClick={clearGlobalScope}>ล้างตัวกรอง</Button></Stack>}
    {flow === 'intake_room' && <IntakeRoomPanel tableToolsRef={intakeTableToolsRef} globalScope={globalScope} onVisibleCountChange={setVisibleIntakeCount} />}
    {(flow === 'omni_filter' || flow === 'hr_confirmation') && (
      <StandardDataTable
        rows={omniTasks}
        getRowId={(row) => row.id}
        getSearchText={(row) => [
          row.department,
          row.task_status,
          row.omni_intake_sources?.source_channel,
          row.omni_intake_sources?.source_room_name,
          row.omni_intake_sources?.source_sender_name,
          row.omni_intake_sources?.conversation_type,
          row.omni_intake_sources?.ai_summary,
          row.omni_intake_sources?.text_content,
        ].filter(Boolean).join(' ')}
        searchLabel="ค้นหาแผนก ต้นทาง ห้อง ผู้ส่ง สรุป หรือข้อความ"
        exportFileName="omni-filter-queue"
        hideBuiltInToolbarActions
        hideToolbar
        onToolsReady={(tools) => { flowTableToolsRef.current = tools }}
        defaultSort={{ columnId: 'updated', direction: 'desc' }}
        toolbar={<Alert severity="info" sx={{ width: '100%' }}>{flow === 'hr_confirmation' ? `HR Pending Queue · Candidate ${hrGateSummary.candidate} · Summary/System ${hrGateSummary.system} · Duplicate ${hrGateSummary.duplicate} · Low confidence ${hrGateSummary.low_confidence} — Web Chat → AI ลงเวลา → รวมตามช่าง/วัน/โครงการ → HR ยืนยัน` : 'ศูนย์กลางนี้รับจาก LINE/Web Chat → วิเคราะห์บทสนทนา → กันรายการซ้ำ → ส่งต่อ Filter ตามแผนก โดยยังคงข้อมูลต้นทางไว้ตรวจย้อนหลัง'}</Alert>}
        columns={[
          { id: 'updated', label: 'อัปเดต', minWidth: 145, render: (row) => new Date(row.updated_at).toLocaleString('th-TH'), sortValue: (row) => new Date(row.updated_at), exportValue: (row) => row.updated_at },
          { id: 'source', label: 'ต้นทาง', minWidth: 140, render: (row) => <Stack spacing={.25}><Chip size="small" color={row.omni_intake_sources?.source_channel === 'web_chat' ? 'info' : 'success'} label={row.omni_intake_sources?.source_channel === 'web_chat' ? 'Web Chat' : 'LINE'} /><Typography variant="caption" color="text.secondary">{row.omni_intake_sources?.source_kind ?? 'message'}</Typography></Stack>, exportValue: (row) => row.omni_intake_sources?.source_channel ?? '' },
          { id: 'room_sender', label: 'ห้อง / ผู้ส่ง', minWidth: 220, render: (row) => <Stack spacing={.25}><Typography sx={{ fontWeight: 700 }}>{row.omni_intake_sources?.source_room_name ?? 'ไม่ระบุห้อง'}</Typography><Typography variant="caption" color="text.secondary">{row.omni_intake_sources?.source_sender_name ?? 'ไม่ระบุผู้ส่ง'}</Typography></Stack>, exportValue: (row) => `${row.omni_intake_sources?.source_room_name ?? ''} ${row.omni_intake_sources?.source_sender_name ?? ''}` },
          { id: 'analysis', label: 'AI วิเคราะห์', minWidth: 190, render: (row) => <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}><Chip size="small" label={omniConversationLabels[row.omni_intake_sources?.conversation_type ?? 'unknown'] ?? row.omni_intake_sources?.conversation_type ?? 'รอคัดแยก'} /><Chip size="small" color={(row.omni_intake_sources?.confidence ?? 0) >= .8 ? 'success' : 'warning'} label={confidence(row.omni_intake_sources?.confidence ?? null)} />{flow === 'hr_confirmation' && row.omni_intake_sources?.hr_bundle?.gate && <Chip size="small" color={row.omni_intake_sources.hr_bundle.gate === 'candidate' ? 'success' : row.omni_intake_sources.hr_bundle.gate === 'low_confidence' ? 'warning' : 'info'} label={{ candidate: 'Candidate', system: 'Summary/System', duplicate: 'Duplicate/Confirmed', low_confidence: 'Not HR/Low confidence' }[row.omni_intake_sources.hr_bundle.gate]} />}</Stack>, exportValue: (row) => row.omni_intake_sources?.conversation_type ?? '' },
          { id: 'department', label: 'ปลายทาง', minWidth: 150, render: (row) => <Chip size="small" color={row.required ? 'primary' : 'default'} label={departmentLabels[row.department] ?? row.department} />, exportValue: (row) => departmentLabels[row.department] ?? row.department },
          { id: 'dedupe', label: 'ซ้ำ/ต้นฉบับ', minWidth: 135, render: (row) => <Chip size="small" color={row.omni_intake_sources?.dedupe_status === 'primary' ? 'success' : 'warning'} label={omniDedupeLabels[row.omni_intake_sources?.dedupe_status ?? 'primary'] ?? row.omni_intake_sources?.dedupe_status ?? '-'} />, exportValue: (row) => row.omni_intake_sources?.dedupe_status ?? '' },
          { id: 'summary', label: 'สรุปสำหรับ Filter', minWidth: 300, render: (row) => <Stack spacing={.25}><Typography noWrap sx={{ maxWidth: 360 }}>{row.omni_intake_sources?.ai_summary ?? row.omni_intake_sources?.text_content ?? '-'}</Typography>{(row.omni_intake_sources?.attachment_count ?? 0) > 0 && <Typography variant="caption" color="text.secondary">แนบไฟล์ {row.omni_intake_sources?.attachment_count} รายการ</Typography>}</Stack>, exportValue: (row) => row.omni_intake_sources?.ai_summary ?? row.omni_intake_sources?.text_content ?? '' },
          ...(flow === 'hr_confirmation' ? [{ id: 'hr_bundle', label: 'HR Confirmation Bundle', minWidth: 380, render: (row: OmniFilterTaskRow) => { const bundle = row.omni_intake_sources?.hr_bundle; return <Stack spacing={.25}><Typography>{bundle?.worker_name ?? '-'} · {bundle?.project_name ?? '-'}</Typography><Typography variant="caption">สมาชิก {bundle?.member_count ?? 0} · ขาด: {bundle?.missing_events?.join(', ') || 'ไม่มี'} · ซ้ำ {bundle?.duplicate_count ?? 0} · ขัดแย้ง {bundle?.conflict_count ?? 0}</Typography><Typography variant="caption" color="text.secondary">ผู้รับผิดชอบ: {bundle?.responsible ?? '-'} · ต่อไป: {bundle?.next_action ?? '-'}</Typography></Stack> }, exportValue: (row: OmniFilterTaskRow) => row.omni_intake_sources?.hr_bundle?.worker_name ?? '' }] : []),
          { id: 'status', label: 'สถานะงาน', minWidth: 140, render: (row) => <Chip size="small" label={omniTaskStatusLabels[row.task_status] ?? row.task_status} />, exportValue: (row) => row.task_status },
        ]}
      />
    )}
    <Drawer anchor="right" open={globalFilterOpen} onClose={() => setGlobalFilterOpen(false)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 }, p: 3 } } }}>
      <Stack spacing={2}>
        <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>ตัวกรองและมุมมองศูนย์เอกสาร</Typography><Typography variant="body2" color="text.secondary">เลือกคิวจาก Drawer เดียว ค่าใน URL และรายการจะเปลี่ยนตามจริง</Typography></Box>
        <FormControl size="small" fullWidth><InputLabel>มุมมองหลัก</InputLabel><Select label="มุมมองหลัก" value={flow} onChange={(event) => { const next = event.target.value as ViewMode; if (next === 'omni_filter' || next === 'hr_confirmation') setFlow(next); else { setQueueView(next); setFlow(next) } setStatus('all'); setTypeFilter('all'); setDestinationDepartment('all') }}><MenuItem value="intake_room">Intake Room · คิวรับเข้า</MenuItem><MenuItem value="filter">Document Filter · คัดแยกเอกสาร</MenuItem><MenuItem value="task_types">คิวงานปลายทาง</MenuItem><MenuItem value="omni_filter">ข้อความและบริบท</MenuItem><MenuItem value="hr_confirmation">HR Confirmation · ชุดยืนยันลงเวลา</MenuItem></Select></FormControl>
        <FormControl size="small" fullWidth><InputLabel>ช่องทาง</InputLabel><Select label="ช่องทาง" value={globalScope.channel ?? 'all'} onChange={(event) => updateGlobalScope({ channel: event.target.value as DocumentFlowScope['channel'] })}><MenuItem value="all">ทุกช่องทาง</MenuItem><MenuItem value="line">LINE</MenuItem><MenuItem value="telegram">Telegram</MenuItem><MenuItem value="web_chat">Web Chat</MenuItem><MenuItem value="hr">HR</MenuItem><MenuItem value="unknown">ไม่ทราบต้นทาง</MenuItem></Select></FormControl>
        <TextField size="small" type="date" label="วันที่รับเข้า" value={globalScope.date ?? ''} onChange={(event) => updateGlobalScope({ date: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
        <TextField size="small" label="ห้องต้นทาง" value={globalScope.room ?? ''} onChange={(event) => updateGlobalScope({ room: event.target.value })} fullWidth />
        <TextField size="small" label="ผู้ส่ง" value={globalScope.sender ?? ''} onChange={(event) => updateGlobalScope({ sender: event.target.value })} fullWidth />
        <FormControl size="small" fullWidth><InputLabel>ประเภทไฟล์</InputLabel><Select label="ประเภทไฟล์" value={globalScope.fileKind ?? 'all'} onChange={(event) => updateGlobalScope({ fileKind: event.target.value as DocumentFlowScope['fileKind'] })}><MenuItem value="all">ทุกประเภทไฟล์</MenuItem><MenuItem value="image_or_scan">รูป/สแกน</MenuItem><MenuItem value="pdf">PDF</MenuItem><MenuItem value="document">เอกสาร</MenuItem><MenuItem value="unknown">ไม่ระบุชนิด</MenuItem></Select></FormControl>
        <TextField size="small" label="โครงการ" value={globalScope.project ?? ''} onChange={(event) => updateGlobalScope({ project: event.target.value })} fullWidth />
        <Stack direction="row" spacing={1}><Button fullWidth variant="outlined" onClick={selectTodayScope}>วันนี้</Button><Button fullWidth onClick={clearGlobalScope}>ล้างทั้งหมด</Button></Stack>
        <Button variant="contained" onClick={() => setGlobalFilterOpen(false)}>ใช้ตัวกรอง</Button>
      </Stack>
    </Drawer>
    {flow !== 'intake_room' && flow !== 'omni_filter' && (
    <>
    <StandardDataTable
      rows={visible} getRowId={(row) => row.id} getSearchText={(row) => Object.values(row).join(' ')}
      searchLabel="ค้นหา Intake ID ผู้ขาย โครงการ ประเภท สถานะ หรือห้อง" exportFileName={`document-${flow}-flow`}
      onRowClick={(row) => {
        ++previewRequestRef.current
        setSelectedItem(row)
        setPreviewFiles([])
        setPreviewIndex(0)
        setPreviewMessage('')
        setRouteDepartment(row.target_department ?? taskCategoryOf(row))
        setRouteCandidates(row.candidate_departments ?? [])
        const defaultDepartments = row.document_type === 'cash_receipt'
          ? ['accounting']
          : (row.candidate_departments?.length ? row.candidate_departments : [row.target_department ?? taskCategoryOf(row)])
        setRouteDepartments(defaultDepartments)
        setRequiredDepartments(defaultDepartments)
        setDestinationTasks([])
        void loadDestinationTasks(row.id)
        setRouteDocumentType(row.document_type ?? 'other')
        setRouteNote('')
        setSelectedProjectId(row.project_id ?? '')
        setSelectedWorkPackageId(row.work_package_id ?? '')
        setNewWorkPackageName('')
        setNewWorkPackageDetail('')
        void loadTransferSlipParties(row)
      }}
      hideBuiltInToolbarActions
      hideToolbar
      onToolsReady={(tools) => { flowTableToolsRef.current = tools }}
      defaultSort={{ columnId: 'updated', direction: 'desc' }} toolbar={<Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel>สถานะ</InputLabel><Select value={status} label="สถานะ" onChange={(event) => setStatus(event.target.value)}>
            <MenuItem value="all">ทุกสถานะ</MenuItem>{statuses.map((value) => <MenuItem key={value} value={value}>{stateLabels[value] ?? value}</MenuItem>)}
          </Select>
        </FormControl>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel>ประเภท</InputLabel><Select value={normalizedTypeFilter} label="ประเภท" onChange={(event) => setTypeFilter(event.target.value)}>
          <MenuItem value="all">ทุกประเภท</MenuItem>{typeOptions.map((value) => <MenuItem key={value} value={value}>{typeLabels[value] ?? value}</MenuItem>)}
        </Select>
      </FormControl>
      </Stack>}
      columns={[
        { id: 'updated', label: 'อัปเดตล่าสุด', minWidth: 160, render: (row) => new Date(row.updated_at).toLocaleString('th-TH'), sortValue: (row) => new Date(row.updated_at) },
        { id: 'created', label: 'รับเข้าเมื่อ', minWidth: 160, render: (row) => new Date(row.created_at).toLocaleString('th-TH'), sortValue: (row) => new Date(row.created_at), exportValue: (row) => row.created_at },
        { id: 'source', label: 'ต้นทาง', minWidth: 180, render: (row) => <Stack spacing={.25}><Chip size="small" label={row.source_channel ?? 'ไม่ระบุช่องทาง'} /><Typography variant="caption" color="text.secondary">{row.source_room_name ?? 'ไม่ระบุห้อง'}</Typography></Stack>, exportValue: (row) => `${row.source_channel ?? ''} ${row.source_room_name ?? ''}` },
        { id: 'sender', label: 'ผู้ส่ง', minWidth: 150, render: (row) => row.source_sender_name ?? 'ไม่ระบุผู้ส่ง', exportValue: (row) => row.source_sender_name ?? '' },
        { id: 'intake', label: 'Intake ID', minWidth: 125, render: (row) => <Typography sx={{ fontFamily: 'monospace' }}>{row.intake_id.slice(0, 8)}…</Typography>, exportValue: (row) => row.intake_id },
        { id: 'type', label: 'ประเภท', minWidth: 170, render: (row) => typeLabels[row.document_type ?? 'other'] ?? row.document_type ?? '-' },
        { id: 'department', label: 'ปลายทาง', minWidth: 190, render: (row) => <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{departmentsFor(row).map((department) => <Chip key={department} size="small" label={departmentLabels[department]} />)}</Stack>, exportValue: (row) => departmentsFor(row).join(', ') },
        { id: 'assignment', label: 'คิวงาน', minWidth: 150, render: (row) => row.assignment_status === 'candidate_review' ? <Chip size="small" color="warning" label="รอยืนยันปลายทาง" /> : row.assignment_status === 'claimed' || row.assignment_status === 'in_progress' ? <Chip size="small" color="success" label="มีผู้รับงาน" /> : <Chip size="small" label="รอมอบหมาย" /> },
        { id: 'assignee', label: 'ผู้รับผิดชอบ', minWidth: 145, render: (row) => row.assignment_status === 'claimed' || row.assignment_status === 'in_progress' ? 'มีผู้รับงานแล้ว' : 'ยังไม่มอบหมาย' },
        { id: 'next_action', label: 'สิ่งที่ต้องทำต่อ', minWidth: 165, render: (row) => nextActionLabel(row), exportValue: (row) => nextActionLabel(row) },
        { id: 'latest_comment', label: 'Comment ล่าสุด', minWidth: 220, render: (row) => <Typography noWrap sx={{ maxWidth: 220 }}>{latestComment(row)}</Typography>, exportValue: (row) => latestComment(row) },
        { id: 'route_target', label: 'เส้นทางรับเข้า', minWidth: 170, render: (row) => <Typography sx={{ whiteSpace: 'nowrap' }}>{routeTargetLabel(row.route_target)}</Typography>, exportValue: (row) => row.route_target ?? '' },
        { id: 'vendor', label: 'ผู้ขาย/คู่ค้า', minWidth: 210, render: (row) => row.vendor_name ?? '-' },
        { id: 'project', label: 'โครงการ', minWidth: 160, render: (row) => row.projects?.name ?? 'ไม่ระบุ' },
        { id: 'amount', label: 'ยอดรวม', align: 'right', minWidth: 120, render: (row) => money(row.total_amount), sortValue: (row) => row.total_amount ?? 0 },
        { id: 'confidence', label: 'AI', minWidth: 100, render: (row) => <Chip size="small" color={(row.confidence ?? 0) >= .9 ? 'success' : 'warning'} label={confidence(row.confidence)} />, sortValue: (row) => row.confidence ?? 0 },
        { id: 'data_review', label: 'ข้อมูล', minWidth: 190, render: (row) => <Stack spacing={.25}><Chip size="small" color={dataReviewColor(row.data_review_status)} label={dataReviewLabels[row.data_review_status ?? 'complete']} />{row.data_review_note && <Typography variant="caption" noWrap sx={{ maxWidth: 180 }}>{row.data_review_note}</Typography>}</Stack>, exportValue: (row) => dataReviewLabels[row.data_review_status ?? 'complete'] },
        { id: 'quality', label: 'ความเสี่ยง', minWidth: 135, render: (row) => {
          const hasIssue = row.issue_codes.length > 0
          if (row.last_error) return <Chip size="small" color="error" label="มีข้อผิดพลาด" />
          if ((row.confidence ?? 0) < .9) return <Chip size="small" color="warning" label="เสี่ยง AI" />
          if (hasIssue) return <Chip size="small" color="warning" label="มีปัญหา" />
          return <Chip size="small" color="success" label="ปกติ" />
        }},
        { id: 'issue', label: 'Issue', minWidth: 170, render: (row) => {
          if (row.issue_codes.length === 0) return <Typography color="text.secondary">-</Typography>
          return <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {row.issue_codes.map((code) => <Chip key={code} size="small" label={code} color="warning" />)}
          </Stack>
        }, exportValue: (row) => row.issue_codes.join(', ')},
        { id: 'state', label: 'สถานะ', minWidth: 185, render: (row) => <Chip size="small" label={stateLabels[row.state] ?? row.state} />, exportValue: (row) => row.state },
        { id: 'room', label: 'ห้อง/ปลายทาง', minWidth: 230, render: (row) => <Stack direction="row" spacing={.5}><RouteOutlinedIcon fontSize="small" color="primary" /><span>{roomLabel(row.current_room)}</span></Stack>, exportValue: (row) => row.current_room },
        { id: 'version', label: 'Version', minWidth: 80, render: (row) => `v${row.version}`, sortValue: (row) => row.version },
        { id: 'actions', label: 'ดำเนินการ', minWidth: 250, render: (row) => <Stack direction="row" spacing={.5} onClick={(event) => event.stopPropagation()}>
          <Tooltip title="ดู Timeline"><IconButton size="small" onClick={() => void openTimeline(row)}><HistoryOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          {availableActions(row).map((action) => <Button key={action} size="small" variant={action === 'approve' || action === 'route_filter' ? 'contained' : 'outlined'} startIcon={<PlayArrowOutlinedIcon />} disabled={workingId === row.id} onClick={() => void transition(row, action)}>{actionLabels[action]}</Button>)}
        </Stack>, exportValue: (row) => availableActions(row).map((action) => actionLabels[action]).join(', ') },
      ]}
    />
    {nextCursor && <Stack direction="row" sx={{ justifyContent: 'center' }}><Button disabled={loading} onClick={() => void load(nextCursor, true)}>Load next page</Button></Stack>}
    <Dialog open={Boolean(timelineItem)} onClose={() => setTimelineItem(null)} fullWidth maxWidth="md">
      <DialogTitle>Timeline — Intake {timelineItem?.intake_id.slice(0, 8)}…</DialogTitle>
      <DialogContent dividers><Stack spacing={1.25}>
        {events.length === 0 && <Typography color="text.secondary">ยังไม่พบเหตุการณ์</Typography>}
        {events.map((event) => <Paper key={event.id} variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 1 }}>
            <Box><Typography sx={{ fontWeight: 700 }}>{actionLabels[event.event_type] ?? event.event_type}</Typography>
              <Typography variant="body2" color="text.secondary">
                {flowLabels[event.from_flow ?? ''] ?? event.from_flow ?? '-'} / {stateLabels[event.from_state ?? ''] ?? event.from_state ?? '-'} → {flowLabels[event.to_flow ?? ''] ?? event.to_flow ?? '-'} / {stateLabels[event.to_state ?? ''] ?? event.to_state ?? '-'}
              </Typography>{event.note && <Typography variant="body2">หมายเหตุ: {event.note}</Typography>}</Box>
            <Typography variant="caption" color="text.secondary">{new Date(event.created_at).toLocaleString('th-TH')}</Typography>
          </Stack>
        </Paper>)}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setTimelineItem(null)}>ปิด</Button></DialogActions>
    </Dialog>
    <Drawer anchor="right" open={Boolean(selectedItem)} onClose={() => { ++previewRequestRef.current; setSelectedItem(null); setPreviewFiles([]); setPreviewIndex(0); setPreviewMessage(''); setTransferSlipParties(null); setTransferSlipPartiesMessage('') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, p: 3 } } }}>
      {selectedItem && <Stack spacing={2}>
        <Box><Typography variant="overline" color="text.secondary">ความสัมพันธ์ข้ามห้อง</Typography><Typography variant="h5" sx={{ fontWeight: 800 }}>{typeLabels[selectedItem.document_type ?? 'other'] ?? selectedItem.document_type ?? 'เอกสาร'}</Typography><Typography variant="body2" color="text.secondary">Intake → Filter → {departmentLabels[selectedItem.target_department ?? taskCategoryOf(selectedItem)] ?? 'คิวปลายทาง'} · สถานะ {stateLabels[selectedItem.state] ?? selectedItem.state}</Typography></Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Chip label={flowLabels[selectedItem.current_flow] ?? selectedItem.current_flow} color="primary" /><Chip label={dataReviewLabels[selectedItem.data_review_status ?? 'complete']} color={dataReviewColor(selectedItem.data_review_status)} /> <Chip label={selectedItem.sensitivity === 'restricted_hr' ? 'ข้อมูล HR จำกัดสิทธิ์' : selectedItem.sensitivity === 'financial' ? 'ข้อมูลการเงิน' : 'ข้อมูลทั่วไป'} color={selectedItem.sensitivity === 'restricted_hr' ? 'warning' : 'default'} /><Chip label={`Version ${selectedItem.version}`} /></Stack>
        <Paper variant="outlined" sx={{ p: 1.5 }}><Stack spacing={.5}><Typography variant="subtitle2" sx={{ fontWeight: 800 }}>เส้นทางและผู้รับผิดชอบ</Typography><Typography variant="body2">ต้นทาง: {selectedItem.source_channel ?? 'ไม่ระบุ'} · {selectedItem.source_room_name ?? 'ไม่ระบุห้อง'} · ผู้ส่ง {selectedItem.source_sender_name ?? 'ไม่ระบุ'}</Typography><Typography variant="body2">รับเข้า: {dateTime(selectedItem.source_received_at ?? selectedItem.created_at)} · ปลายทาง: {departmentsFor(selectedItem).map((department) => departmentLabels[department]).join(', ')}</Typography><Typography variant="body2">สถานะรับงาน: {selectedItem.assignment_status === 'claimed' || selectedItem.assignment_status === 'in_progress' ? 'มีผู้รับผิดชอบแล้ว' : 'ยังไม่รับงาน'} · สิ่งที่ต้องทำต่อ: {nextActionLabel(selectedItem)}</Typography><Typography variant="body2" color="text.secondary">Comment ล่าสุด: {latestComment(selectedItem)}</Typography></Stack></Paper>
        {selectedItem.data_review_note && <Alert severity={selectedItem.data_review_status === 'incomplete' ? 'error' : 'warning'}>สถานะข้อมูล: {selectedItem.data_review_note}</Alert>}
        <Button variant="outlined" onClick={() => void openPreview(selectedItem)}>เปิดเอกสาร/รูปต้นฉบับ</Button>
        {previewMessage && <Alert severity="info">{previewMessage}</Alert>}
        {previewFiles.length > 1 && <Stack direction="row" spacing={.5} useFlexGap sx={{ flexWrap: 'wrap' }}>{previewFiles.map((file, index) => <Button key={file.url} size="small" variant={index === previewIndex ? 'contained' : 'outlined'} onClick={() => setPreviewIndex(index)}>{file.label}</Button>)}</Stack>}
        {activePreview && <><Button size="small" component="a" href={activePreview.url} target="_blank" rel="noreferrer" endIcon={<OpenInNewOutlinedIcon />}>เปิดในแท็บใหม่</Button>
          {activePreview.contentType?.startsWith('image/') ? <Box component="img" src={activePreview.url} alt="ไฟล์ต้นฉบับ" sx={{ width: '100%', maxHeight: 500, objectFit: 'contain', borderRadius: 1, bgcolor: 'grey.100' }} /> : <Box component="iframe" title="ไฟล์ต้นฉบับ" src={activePreview.url} sx={{ width: '100%', height: 420, border: 0, borderRadius: 1 }} />}
        </>}
        {selectedItem.document_type === 'transfer_slip' && <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>ข้อมูลธุรกรรมสลิป</Typography>
            {transferSlipPartiesMessage && <Alert severity={transferSlipParties ? 'info' : 'warning'}>{transferSlipPartiesMessage}</Alert>}
            {transferSlipParties && <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary">ผู้โอน</Typography><Typography variant="body2">{transferSlipParties.sender_name ?? 'ยังไม่ระบุ'}</Typography><Typography variant="caption" color="text.secondary">{transferSlipParties.sender_bank_name ?? 'ยังไม่ระบุธนาคาร'} · {maskedAccount(transferSlipParties.sender_account_last4)}</Typography></Box>
                <Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary">ผู้รับ</Typography><Typography variant="body2">{transferSlipParties.recipient_name ?? 'ยังไม่ระบุ'}</Typography><Typography variant="caption" color="text.secondary">{transferSlipParties.recipient_bank_name ?? 'ยังไม่ระบุธนาคาร'} · {maskedAccount(transferSlipParties.recipient_account_last4)}</Typography></Box>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Typography variant="caption" sx={{ flex: 1 }}>เวลาโอน: {dateTime(transferSlipParties.transfer_at)}</Typography>
                <Typography variant="caption" sx={{ flex: 1 }}>เลขอ้างอิง: {transferSlipParties.bank_reference ?? 'ยังไม่ระบุ'}</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">ความมั่นใจข้อมูลคู่โอน: {confidence(transferSlipParties.payment_party_confidence)}</Typography>
            </>}
          </Stack>
        </Paper>}
        {flow === 'filter' && <>
          <TextField select label="ประเภทเอกสาร" value={routeDocumentType} onChange={(event) => setRouteDocumentType(event.target.value)}>{typeOrder.map((type) => <MenuItem key={type} value={type}>{typeLabels[type]}</MenuItem>)}</TextField>
          <Paper variant="outlined" sx={{ p: 1.5 }}><Stack spacing={.5}>
            <Typography variant="subtitle2">ส่งงานไปหลายปลายทาง</Typography>
            <Typography variant="caption" color="text.secondary">เลือกงานที่ต้องทำจริง และกำหนดงานบังคับแยกต่อแผนก — เอกสารต้นฉบับยังเป็นรายการเดียว</Typography>
            {Object.entries(departmentLabels).filter(([value]) => value !== 'admin').map(([value, label]) => {
              const selected = routeDepartments.includes(value)
              const required = requiredDepartments.includes(value)
              return <Stack key={value} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <FormControlLabel control={<Checkbox checked={selected} onChange={(_event, checked) => {
                  setRouteDepartments((current) => checked ? [...new Set([...current, value])] : current.filter((department) => department !== value))
                  setRequiredDepartments((current) => checked ? [...new Set([...current, value])] : current.filter((department) => department !== value))
                  if (checked) setRouteDepartment(value)
                }} />} label={label} />
                {selected && <FormControlLabel control={<Checkbox size="small" checked={required} onChange={(_event, checked) => setRequiredDepartments((current) => checked ? [...new Set([...current, value])] : current.filter((department) => department !== value))} />} label="บังคับ" />}
              </Stack>
            })}
          </Stack></Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}><Stack spacing={1.25}>
            <Typography variant="subtitle2">โครงการและงานย่อย</Typography>
            <TextField select label="โครงการหลัก" value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); setSelectedWorkPackageId('') }}>
              <MenuItem value="">ไม่ระบุโครงการ</MenuItem>{projects.map((project) => <MenuItem key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ''}{project.name}</MenuItem>)}
            </TextField>
            <TextField select label="งานย่อย / WBS" value={selectedWorkPackageId} disabled={!selectedProjectId} onChange={(event) => setSelectedWorkPackageId(event.target.value)} helperText="เลือกได้ทุกระดับ หรือเลือกรายการนี้เป็นงานแม่เพื่อเพิ่มงานลูก">
              <MenuItem value="">ยังไม่ระบุงานย่อย</MenuItem>{selectedWorkPackages.map((workPackage) => <MenuItem key={workPackage.id} value={workPackage.id}>{workPackage.label}</MenuItem>)}
            </TextField>
            <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Typography variant="body2" sx={{ fontWeight: 700 }}>ทะเบียนงานกลางของโครงการ</Typography><Chip size="small" label={`${selectedWorkPackages.length} งาน`} /></Stack></AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {!selectedProjectId ? <Typography variant="caption" color="text.secondary">เลือกโครงการหลักก่อน เพื่อแสดงงานหลักและงานย่อยร่วมทุกแผนก</Typography>
                  : selectedWorkPackageTree.length === 0 ? <Typography variant="caption" color="text.secondary">ยังไม่มีงานย่อยในโครงการนี้ — เพิ่มรายการแรกได้ด้านล่าง</Typography>
                    : <Stack spacing={.25}>{selectedWorkPackageTree.map((workPackage) => renderWorkPackageNode(workPackage))}</Stack>}
              </AccordionDetails>
            </Accordion>
            <Button variant="outlined" disabled={!selectedProjectId || workingId === selectedItem.id} onClick={() => void assignProjectWorkPackage()}>บันทึกโครงการ/งานย่อย</Button>
            <Typography variant="caption" color="text.secondary">ใช้ทะเบียนงานกลางร่วมทุกแผนก; เพิ่มงานใหม่ใต้ {selectedWorkPackageId ? 'งานย่อยที่เลือก' : 'โครงการหลัก'} ได้หลายระดับ</Typography>
            <TextField size="small" label="ชื่องานย่อยใหม่" value={newWorkPackageName} disabled={!selectedProjectId} onChange={(event) => setNewWorkPackageName(event.target.value)} />
            <TextField size="small" label="รายละเอียดงานย่อย" multiline minRows={2} value={newWorkPackageDetail} disabled={!selectedProjectId} onChange={(event) => setNewWorkPackageDetail(event.target.value)} />
            <Button size="small" variant="text" disabled={!selectedProjectId || workingId === selectedItem.id} onClick={() => void createWorkPackage()}>เพิ่มงานย่อย</Button>
          </Stack></Paper>
          <TextField label="หมายเหตุการคัดแยก" multiline minRows={2} value={routeNote} onChange={(event) => setRouteNote(event.target.value)} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button color="warning" variant="outlined" disabled={workingId === selectedItem.id} onClick={() => void markDataReview('recheck_required')}>บันทึกแก้ไข · รอตรวจซ้ำ</Button><Button color="error" variant="outlined" disabled={workingId === selectedItem.id} onClick={() => void markDataReview('incomplete')}>แจ้งข้อมูลไม่ครบ</Button></Stack>
          <Button variant="contained" disabled={workingId === selectedItem.id} onClick={() => void routeMultiDestination()}>สร้างงานและส่งเข้าคิวปลายทาง</Button>
        </>}
        {flow === 'task_types' && <><Typography variant="subtitle2">งานปลายทางของเอกสารนี้</Typography>
          {destinationTasks.length === 0 && <Typography variant="body2" color="text.secondary">ยังไม่มีงานปลายทางแบบแยกรายแผนก</Typography>}
          {destinationTasks.map((task) => <Paper key={task.id} variant="outlined" sx={{ p: 1.25 }}><Stack spacing={.75}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography sx={{ fontWeight: 700 }}>{departmentLabels[task.department] ?? task.department}</Typography><Chip size="small" color={task.status === 'completed' ? 'success' : task.status === 'returned' || task.status === 'recheck_required' ? 'warning' : 'default'} label={`${task.required ? 'บังคับ · ' : 'เลือกได้ · '}${task.status === 'recheck_required' ? 'รอตรวจซ้ำ' : task.status}`} /></Stack>
            {task.note && <Typography variant="caption" color="text.secondary">{task.note}</Typography>}
            <Stack direction="row" spacing={.75}><Button size="small" variant="outlined" disabled={workingId === task.id || !['queued', 'returned', 'recheck_required'].includes(task.status)} onClick={() => void updateDestinationTask(task, 'claim')}>รับงาน</Button><Button size="small" variant="contained" disabled={workingId === task.id || !['queued', 'claimed', 'recheck_required'].includes(task.status)} onClick={() => void updateDestinationTask(task, 'complete')}>ทำเสร็จ</Button><Button size="small" color="warning" disabled={workingId === task.id || task.status === 'completed'} onClick={() => void updateDestinationTask(task, 'return')}>ส่งกลับ Filter</Button></Stack>
          </Stack></Paper>)}
          <TextField label="เหตุผล/หมายเหตุ (จำเป็นเมื่อส่งกลับ)" multiline minRows={2} value={routeNote} onChange={(event) => setRouteNote(event.target.value)} />
          {destinationTasks.length === 0 && <Stack direction="row" spacing={1}><Button variant="outlined" disabled={workingId === selectedItem.id} onClick={() => void routeItem('return_to_filter')}>ส่งกลับ Filter</Button><Button variant="outlined" color="warning" disabled={workingId === selectedItem.id} onClick={() => void routeItem('return_to_intake')}>ส่งกลับ Intake</Button></Stack>}
        </>}
        <Button variant="text" onClick={() => void openTimeline(selectedItem)}>ดู Timeline เต็ม</Button>
      </Stack>}
    </Drawer>
    </>)}
  </Stack>
}

