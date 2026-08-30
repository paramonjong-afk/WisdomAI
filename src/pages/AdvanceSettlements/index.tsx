import { AddOutlined, CloseOutlined, DeleteOutlineOutlined, OpenInNewOutlined, RefreshOutlined, RestoreOutlined } from '@mui/icons-material'
import { Alert, Box, Button, ButtonBase, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, Tabs, TextField, Typography } from '@mui/material'
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined'
import HourglassEmptyOutlined from '@mui/icons-material/HourglassEmptyOutlined'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined'
import KeyboardArrowLeftOutlined from '@mui/icons-material/KeyboardArrowLeftOutlined'
import KeyboardArrowRightOutlined from '@mui/icons-material/KeyboardArrowRightOutlined'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { queueAdvanceConfirmation, type AdvanceConfirmationDelivery } from '../../services/advanceConfirmationGateway'
import { documentFlowGateway } from '../../services/documentFlowGateway'
import { userError } from '../../utils/userError'
import { isExpiredPreviewUrlError, isImageContentType, normalizePreviewFile, previewLoadMessage, previewSignedUrlErrorMessage, type AdvanceSlipPreviewFile, type PreviewFilePayload } from './advanceSlipPreview'
import { advanceAuditAttemptLabel, buildAdvanceAuditTimeline, type AdvanceAuditEvent } from './advanceAuditTimeline'

type SettlementItem = { id: string; expense_type: string; amount: number; approval_status: string; description: string; expense_date: string; evidence_reference: string | null }
type Audit = AdvanceAuditEvent
type SourceFlow = {
  id: string
  current_flow: string
  current_room: string
  state: string
  version: number
  updated_at: string | null
  target_department: string | null
  candidate_departments: string[] | null
  assignment_status: string | null
}
type SourceSlip = { recipient_name: string | null; sender_name: string | null; sender_bank_name: string | null; sender_account_last4: string | null; recipient_bank_name: string | null; recipient_account_last4: string | null; transfer_at: string | null; payment_party_confidence: number | null }
type AdvanceCase = {
  id: string; advance_number: string; amount_received: number; bank_reference: string | null; status: string; version: number; parent_case_id: string | null; purpose_note: string | null; holder_profile_id: string | null
  rejected_reason_code: string | null; rejected_reason_note: string | null; rejected_by: string | null; rejected_at: string | null
  financial_transactions: SourceSlip | null; source_flow_item_id: string | null; source_flow: SourceFlow | null; holder_profile: { full_name: string | null } | null; holder_person: { full_name: string | null } | null
  employee_advance_settlement_items: SettlementItem[] | null; employee_advance_audit: Audit[] | null
}
type DailyEmployee = { profile_id: string; profiles: { full_name: string | null } | null }
type EmployeeMoneySummary = {
  company_id: string
  employee_profile_id: string
  employee_name: string
  employee_code: string | null
  entry_count: number
  pending_count: number
  approved_advance_balance: number
  pending_advance_amount: number
  approved_wage_paid: number
  pending_wage_paid: number
  updated_at: string
}
type EmployeeMoneyPeriodSummary = {
  company_id: string
  employee_profile_id: string
  employee_name: string
  pay_period_id: string
  pay_period_name: string
  pay_period_starts_on: string
  pay_period_ends_on: string
  pay_period_status: string
  advance_entry_count: number
  pending_review_count: number
  pending_advance_amount: number
  approved_advance_amount: number
  approved_adjustment_net: number
  pending_adjustment_amount: number
  advance_to_deduct: number
  updated_at: string
}
type LegacyEmployeeMoneyCandidate = {
  financial_transaction_id: string
  employee_profile_id: string
  employee_name: string
  sender_name: string | null
  recipient_name: string | null
  amount_total: number
  transfer_at: string | null
  proposed_entry_type: 'advance_issued' | 'wage_paid'
  evidence_date_status: 'verified' | 'unverified'
}
type AdvanceTreeGroup = {
  key: string
  employeeName: string
  rows: AdvanceCase[]
  received: number
  approvedUsed: number
  outstanding: number
}
type PreviewState =
  | { status: 'idle' | 'loading'; message: string; file: null; signedUrl: null }
  | { status: 'missing' | 'error' | 'non_image'; message: string; file: AdvanceSlipPreviewFile | null; signedUrl: string | null }
  | { status: 'ready'; message: string; file: AdvanceSlipPreviewFile; signedUrl: string }
type FlowNodeStatus = 'passed' | 'waiting' | 'missing' | 'rejected'
type FlowNode = { key: string; label: string; status: FlowNodeStatus; time: string | null; owner: string; documentId: string; audit: Audit[]; detail: string }
type DepartmentFilter = 'all' | 'accounting' | 'hr' | 'project_inventory' | 'needs_information'

const departmentLabels: Record<string, string> = {
  accounting: 'บัญชี',
  hr: 'HR',
  project: 'โครงการ',
  inventory: 'คลัง',
  procurement: 'จัดซื้อ',
  admin: 'Admin',
  system: 'ระบบ',
  advance_finance: 'เงินสำรองจ่าย',
}

const labels: Record<string, string> = {
  draft: 'รอแตกยอด', collecting_evidence: 'กำลังรวบรวมหลักฐาน', submitted: 'ส่งตรวจแล้ว', approved: 'อนุมัติแล้ว', closed: 'ปิดยอดแล้ว', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก',
  daily_wage: 'ค่าแรงรายวัน', materials: 'ค่าวัสดุ', travel: 'ค่าเดินทาง', other: 'อื่น ๆ', cash_return: 'คืนเงินบริษัท', payroll_offset: 'หักเงินเดือน', employee_advance: 'เงินเบิกช่าง',
  auto_create_from_holder_registry: 'ระบบสร้างร่างจากชื่อที่เรียนรู้', admin_confirm_name_match: 'Admin ยืนยันชื่อและสอนระบบ', create_from_transfer: 'สร้างจากสลิปต้นทาง', add_settlement_item: 'เพิ่มรายการใช้เงิน', create_sub_advance: 'สร้างเงินเบิกช่าง', submit: 'ส่งตรวจ', approve: 'อนุมัติ', return: 'ส่งกลับแก้ไข', close: 'ปิดยอด',
  rejected: 'Reject / ไม่นับยอด', reject_exclude_from_totals: 'Reject / ตัดออกจากยอด', restore_to_review: 'นำกลับมาตรวจ',
  confirmation_room_setup: 'ตั้งค่าห้องยืนยัน', confirmation_queued: 'เข้าคิวข้อความยืนยัน', confirmation_delivery_failed: 'ส่งข้อความยืนยันไม่สำเร็จ', confirmation_delivered: 'ส่งข้อความยืนยันสำเร็จ',
  advance_issued: 'เงินเบิกล่วงหน้าระหว่างงวด', wage_paid: 'ค่าแรงที่จ่ายหลังปิดงวด', adjustment_debit: 'Adjustment เพิ่มยอด', adjustment_credit: 'Adjustment ลดยอด', reversal: 'กลับรายการ',
}
const rejectReasonLabels: Record<string, string> = { wrong_amount: 'ยอดผิด', duplicate: 'รายการซ้ำ', not_advance: 'ไม่ใช่เงินทดรอง', wrong_type: 'ข้อมูลผิดประเภท', other: 'เหตุผลอื่น' }
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value || 0)
const dateTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('th-TH') : '-'
const holderName = (row: AdvanceCase) => row.holder_profile?.full_name ?? row.holder_person?.full_name ?? row.financial_transactions?.recipient_name ?? '-'
const routeText = (row: AdvanceCase) => row.parent_case_id ? `เงินทดรองหลัก → เงินเบิกช่าง → ${labels[row.status] ?? row.status}` : `สลิป → Intake → Filter → บัญชี → เงินทดรอง (${labels[row.status] ?? row.status})`
const rowDepartments = (row: AdvanceCase) => {
  const departments = new Set(row.source_flow?.candidate_departments ?? [])
  if (row.source_flow?.target_department) departments.add(row.source_flow.target_department)
  const room = row.source_flow?.current_room ?? ''
  if (room.includes('hr') || room.includes('payroll')) departments.add('hr')
  if (room.includes('project')) departments.add('project')
  if (room.includes('inventory')) departments.add('inventory')
  if (room.includes('accounting') || room.includes('posting')) departments.add('accounting')
  if (room.includes('advance_finance')) departments.add('advance_finance')
  if (!departments.size) departments.add('accounting')
  return [...departments]
}
const departmentText = (row: AdvanceCase) => rowDepartments(row).map((department) => departmentLabels[department] ?? department).join(', ')
const nextActionText = (row: AdvanceCase) => {
  if (row.status === 'rejected') return 'แก้ไขหรือนำกลับมาตรวจ'
  if (row.status === 'closed') return 'ปิดยอดแล้ว'
  const readiness = advanceReviewReadiness(row)
  const departments = rowDepartments(row)
  if (departments.includes('hr')) return 'HR ตรวจพนักงานและงวดค่าแรง'
  if (departments.includes('project') || departments.includes('inventory')) return 'โครงการ/คลังตรวจการใช้เงิน'
  return readiness.nextAction
}
const matchesDepartment = (row: AdvanceCase, filter: DepartmentFilter) => {
  if (filter === 'all') return true
  const departments = rowDepartments(row)
  if (filter === 'project_inventory') return departments.includes('project') || departments.includes('inventory')
  if (filter === 'needs_information') return ['draft', 'collecting_evidence', 'returned'].includes(row.status) && !advanceReviewReadiness(row).canSubmit
  return departments.includes(filter)
}
function updateState(row: AdvanceCase) {
  const actions = row.employee_advance_audit ?? []
  if (actions.some((audit) => audit.action === 'admin_confirm_name_match')) return { label: 'Admin ยืนยัน/เรียนรู้ชื่อ', color: 'primary' as const }
  if (actions.some((audit) => audit.action === 'auto_create_from_holder_registry')) return { label: 'สร้างอัตโนมัติจากชื่อที่เรียนรู้', color: 'success' as const }
  if (actions.some((audit) => audit.action === 'create_from_transfer')) return { label: 'สร้างจากชื่อตรง', color: 'secondary' as const }
  return { label: 'ข้อมูลเดิม/รอตรวจที่มา', color: 'default' as const }
}
function sourceQuality(row: AdvanceCase) {
  const source = row.financial_transactions
  if (!source) return { label: 'เงินเบิกจากเคสหลัก', color: 'info' as const }
  const complete = Boolean(source.recipient_name && source.sender_name && source.sender_bank_name && source.sender_account_last4 && source.recipient_bank_name && source.recipient_account_last4)
  if (!complete) return { label: 'ข้อมูลสลิปไม่ครบ', color: 'warning' as const }
  if (Number(source.payment_party_confidence ?? 0) < 0.9) return { label: 'AI ต้องตรวจเพิ่ม', color: 'warning' as const }
  return { label: 'ข้อมูลสลิปครบ', color: 'success' as const }
}
type EmployeeMoneyLedgerEntry = { id: string; employee_profile_id: string; employee_name: string; received_by_profile_id: string | null; received_by_name: string | null; recipient_relationship: string | null; pay_period_id: string | null; pay_period_name: string | null; pay_period_starts_on: string | null; pay_period_ends_on: string | null; pay_period_status: string | null; pay_period_assignment_method: string | null; pay_period_assignment_reason: string | null; source_name: string; account_scope: string; entry_type: string; amount: number; effective_on: string | null; transfer_at: string | null; bank_reference: string | null; sender_name: string | null; recipient_name: string | null; sender_bank_name: string | null; recipient_bank_name: string | null; sender_account_last4: string | null; recipient_account_last4: string | null; financial_transaction_id: string | null; source_flow_item_id: string | null; allocation_id: string | null; evidence_date_status: string; match_method: string; entry_status: string; reason: string | null; created_at: string; version: number; reviewed_by: string | null; reviewed_at: string | null; target_department: string | null; candidate_departments: string[] | null; current_room: string | null; flow_state: string | null; assignment_status: string | null }

function canonicalEmployeeMoneyEntries(entries: EmployeeMoneyLedgerEntry[]) {
  const canonical = new Map<string, EmployeeMoneyLedgerEntry>()
  for (const entry of entries.filter((row) => !['rejected', 'reversed'].includes(row.entry_status))) {
    const key = `${entry.financial_transaction_id ?? entry.id}:${entry.employee_profile_id}:${entry.entry_type}:${entry.amount}`
    const current = canonical.get(key)
    if (!current || (!current.allocation_id && entry.allocation_id)) canonical.set(key, entry)
  }
  return [...canonical.values()]
}

type ReviewCheck = { label: string; detail: string; done: boolean }
type ReviewReadiness = {
  checks: ReviewCheck[]
  nextAction: string
  canSubmit: boolean
  canApprove: boolean
  canClose: boolean
}

function advanceReviewReadiness(row: AdvanceCase): ReviewReadiness {
  const items = row.employee_advance_settlement_items ?? []
  const approvedTotal = items.filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0)
  const pendingItems = items.filter((item) => !['approved', 'rejected'].includes(item.approval_status))
  const outstandingAmount = Number(row.amount_received) - approvedTotal
  const hasSource = Boolean(row.parent_case_id || row.financial_transactions || row.source_flow_item_id)
  const hasHolder = Boolean(row.holder_profile_id || row.holder_profile?.full_name || row.holder_person?.full_name)
  const hasAmount = Number(row.amount_received) > 0
  const hasItems = items.length > 0
  const allItemsDecided = hasItems && pendingItems.length === 0
  const isBalanced = Math.abs(outstandingAmount) < 0.01
  const checks: ReviewCheck[] = [
    { label: 'หลักฐานต้นทาง', detail: hasSource ? 'มีสลิปหรือรายการต้นทางอ้างอิง' : 'ยังไม่มีสลิปหรือรายการต้นทาง', done: hasSource },
    { label: 'ผู้ถือเงิน', detail: hasHolder ? holderName(row) : 'ยังไม่ได้ระบุผู้ถือเงิน', done: hasHolder },
    { label: 'ยอดเงินที่รับมา', detail: hasAmount ? money(Number(row.amount_received)) : 'ยอดต้องมากกว่า 0', done: hasAmount },
    { label: 'รายการใช้เงิน/คืนเงิน', detail: hasItems ? `${items.length} รายการ` : 'ยังไม่ได้แตกยอดการใช้เงิน', done: hasItems },
    { label: 'ตัดสินรายการครบ', detail: allItemsDecided ? 'ไม่มีรายการค้างอนุมัติ' : `ยังค้าง ${pendingItems.length} รายการ`, done: allItemsDecided },
    { label: 'ยอดคงค้างเป็นศูนย์', detail: isBalanced ? 'ยอดสมดุล พร้อมปิด' : `คงค้าง ${money(outstandingAmount)}`, done: isBalanced },
  ]
  const canSubmit = ['draft', 'collecting_evidence', 'returned'].includes(row.status) && hasSource && hasHolder && hasAmount && hasItems
  const canApprove = row.status === 'submitted' && hasSource && hasHolder && hasAmount && hasItems
  const canClose = row.status === 'approved' && allItemsDecided && isBalanced
  let nextAction = 'รายการนี้ปิดยอดเรียบร้อยแล้ว'
  if (row.status === 'cancelled') nextAction = 'รายการนี้ถูกยกเลิกแล้ว ไม่ต้องดำเนินการต่อ'
  else if (['draft', 'collecting_evidence', 'returned'].includes(row.status)) nextAction = canSubmit ? 'ตรวจหลักฐานแล้วกด “ส่งตรวจ”' : 'เติมข้อมูลที่ยังขาด แล้วจึงส่งตรวจ'
  else if (row.status === 'submitted') nextAction = canApprove ? 'ตรวจรายการและกด “อนุมัติ”' : 'เติมข้อมูลที่ยังขาดก่อนอนุมัติ'
  else if (row.status === 'approved') nextAction = canClose ? 'ยอดสมดุลแล้ว กด “ปิดยอด” ได้' : 'เคลียร์รายการค้างและยอดคงเหลือก่อนปิดยอด'
  return { checks, nextAction, canSubmit, canApprove, canClose }
}

function previewSeverity(status: PreviewState['status']) {
  if (status === 'error') return 'error' as const
  if (status === 'missing' || status === 'non_image') return 'warning' as const
  return 'info' as const
}

function sourceRoute(row: AdvanceCase) {
  if (row.parent_case_id) return `เงินทดรองหลัก → เงินเบิกช่าง → ${labels[row.status] ?? row.status}`
  return `สลิป → Intake → Filter → บัญชี → เงินทดรอง (${labels[row.status] ?? row.status})`
}

function flowStatusLabel(status: FlowNodeStatus) {
  return { passed: 'ผ่าน', waiting: 'กำลังรอ', missing: 'ขาดข้อมูล', rejected: 'Reject/ส่งกลับ' }[status]
}

function flowStatusColor(status: FlowNodeStatus) {
  return { passed: 'success', waiting: 'warning', missing: 'default', rejected: 'error' }[status] as 'success' | 'warning' | 'default' | 'error'
}

function latestAudit(audits: Audit[], actions: string[]) {
  return audits.filter((audit) => actions.includes(audit.action)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
}

function flowNodes(row: AdvanceCase): FlowNode[] {
  const audits = row.employee_advance_audit ?? []
  const documentId = row.source_flow?.id ?? row.source_flow_item_id ?? '-'
  const routeOwner = row.source_flow?.current_room || 'ระบบ/ไม่ระบุจาก audit'
  const rejected = ['returned', 'cancelled', 'rejected'].includes(row.status) || audits.some((audit) => /reject|return|cancel/i.test(audit.action))
  const sourceAudit = latestAudit(audits, ['create_from_transfer', 'auto_create_from_holder_registry', 'admin_confirm_name_match'])
  const intakeAudit = latestAudit(audits, ['create_from_transfer', 'auto_create_from_holder_registry', 'admin_confirm_name_match'])
  const classifyAudit = latestAudit(audits, ['admin_confirm_name_match', 'auto_create_from_holder_registry'])
  const accountingAudit = latestAudit(audits, ['confirmation_queued', 'confirmation_delivered'])
  const settlementAudit = latestAudit(audits, ['add_settlement_item', 'submit', 'approve'])
  const closeAudit = latestAudit(audits, ['close'])
  const settlementReady = (row.employee_advance_settlement_items ?? []).some((item) => item.approval_status === 'approved')
  const statusFor = (passed: boolean, missing: boolean, audit: Audit | null): FlowNodeStatus => rejected ? 'rejected' : missing ? 'missing' : passed ? 'passed' : audit ? 'waiting' : 'waiting'
  return [
    { key: 'slip', label: 'สลิปต้นทาง', status: statusFor(Boolean(row.financial_transactions), !row.financial_transactions, sourceAudit), time: sourceAudit?.created_at ?? row.financial_transactions?.transfer_at ?? null, owner: 'Intake / ระบบ', documentId, audit: audits, detail: row.financial_transactions ? 'พบ metadata สลิปต้นทาง' : 'ยังไม่พบข้อมูลสลิปต้นทาง' },
    { key: 'intake', label: 'Intake', status: statusFor(Boolean(row.source_flow), !row.source_flow, intakeAudit), time: row.source_flow?.updated_at ?? intakeAudit?.created_at ?? null, owner: row.source_flow?.current_room ?? 'Intake / ไม่ระบุ', documentId, audit: audits, detail: row.source_flow ? `สถานะ ${row.source_flow.state}` : 'ไม่พบ Document Flow Item' },
    { key: 'classify', label: 'ตรวจ/แยกประเภท', status: statusFor(Boolean(classifyAudit), !sourceQuality(row).label.includes('ครบ'), classifyAudit), time: classifyAudit?.created_at ?? null, owner: 'ระบบ/ผู้ตรวจจาก audit', documentId, audit: audits, detail: sourceQuality(row).label },
    { key: 'accounting', label: 'บัญชี', status: statusFor(Boolean(accountingAudit) || row.source_flow?.current_room?.includes('accounting') === true, !row.source_flow, accountingAudit), time: accountingAudit?.created_at ?? row.source_flow?.updated_at ?? null, owner: routeOwner, documentId, audit: audits, detail: row.source_flow ? `${row.source_flow.current_flow} / ${row.source_flow.current_room}` : 'ยังไม่ถึงบัญชี' },
    { key: 'advance', label: 'เงินสำรองจ่าย', status: statusFor(Boolean(row.id), false, sourceAudit), time: sourceAudit?.created_at ?? null, owner: holderName(row), documentId: row.id, audit: audits, detail: `Advance ID: ${row.id}` },
    { key: 'settlement', label: 'ค่าแรง/ตัดยอด', status: statusFor(settlementReady || row.status === 'closed', !row.employee_advance_settlement_items?.length, settlementAudit), time: settlementAudit?.created_at ?? null, owner: 'ผู้ตรวจรายการจ่าย / ไม่ระบุ', documentId: row.id, audit: audits, detail: settlementReady ? 'มีรายการจ่ายที่อนุมัติแล้ว' : 'ยังไม่มีรายการจ่ายที่อนุมัติ' },
    { key: 'close', label: 'ปิดงาน', status: statusFor(row.status === 'closed', false, closeAudit), time: closeAudit?.created_at ?? null, owner: 'ผู้อนุมัติ / ไม่ระบุ', documentId: row.id, audit: audits, detail: `สถานะเคส: ${labels[row.status] ?? row.status}` },
  ]
}

function FlowStatusIcon({ status }: { status: FlowNodeStatus }) {
  if (status === 'passed') return <CheckCircleOutlineOutlined color="success" fontSize="small" />
  if (status === 'rejected') return <ErrorOutlineOutlined color="error" fontSize="small" />
  if (status === 'missing') return <InfoOutlined color="disabled" fontSize="small" />
  return <HourglassEmptyOutlined color="warning" fontSize="small" />
}

export function AdvanceSettlementsPage() {
  usePageTitle('เงินทดรองและปิดยอด')
  const { currentCompany, profile } = useAuth()
  const [rows, setRows] = useState<AdvanceCase[]>([])
  const [selected, setSelected] = useState<AdvanceCase | null>(null)
  const [reviewQueueIds, setReviewQueueIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<AdvanceConfirmationDelivery | null>(null)
  const [lineOpen, setLineOpen] = useState(false)
  const [subAdvanceOpen, setSubAdvanceOpen] = useState(false)
  const [slipPreview, setSlipPreview] = useState<PreviewState>({ status: 'idle', message: 'ยังไม่ได้เลือกรายการ', file: null, signedUrl: null })
  const [slipPreviewDialogOpen, setSlipPreviewDialogOpen] = useState(false)
  const [dailyEmployees, setDailyEmployees] = useState<DailyEmployee[]>([])
  const [employeeMoneyRows, setEmployeeMoneyRows] = useState<EmployeeMoneySummary[]>([])
  const [employeeMoneyEntries, setEmployeeMoneyEntries] = useState<EmployeeMoneyLedgerEntry[]>([])
  const [employeeMoneyPeriodRows, setEmployeeMoneyPeriodRows] = useState<EmployeeMoneyPeriodSummary[]>([])
  const [selectedEmployeeMoney, setSelectedEmployeeMoney] = useState<EmployeeMoneySummary | null>(null)
  const [selectedEmployeeMoneyEntryId, setSelectedEmployeeMoneyEntryId] = useState<string | null>(null)
  const [employeeMoneyRejectId, setEmployeeMoneyRejectId] = useState<string | null>(null)
  const [employeeMoneyRejectReason, setEmployeeMoneyRejectReason] = useState('')
  const [adjustmentEntry, setAdjustmentEntry] = useState<EmployeeMoneyLedgerEntry | null>(null)
  const [adjustment, setAdjustment] = useState({ type: 'adjustment_credit', amount: '', reason: '', effectiveOn: new Date().toLocaleDateString('en-CA') })
  const [legacyMoneyCandidates, setLegacyMoneyCandidates] = useState<LegacyEmployeeMoneyCandidate[]>([])
  const [employeeMoneyWarning, setEmployeeMoneyWarning] = useState('')
  const [employeeMoneyNotice, setEmployeeMoneyNotice] = useState('')
  const [line, setLine] = useState({ expense_type: 'materials', amount: '', description: '', evidence_reference: '', expense_date: new Date().toLocaleDateString('en-CA') })
  const [subAdvance, setSubAdvance] = useState({ holderProfileId: '', amount: '', description: '' })
  const [activeTab, setActiveTab] = useState(0)
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>('all')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState({ code: 'not_advance', note: '' })
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreReason, setRestoreReason] = useState('นำกลับมาตรวจสอบโดย Admin')
  const loadRequestRef = useRef(0)
  const previewRequestRef = useRef(0)
  const companyId = currentCompany?.company_id ?? ''
  const canManageAdvance = profile?.role === 'admin' || profile?.role === 'manager'
  const load = useCallback(async () => {
    if (!companyId) return
    const requestId = ++loadRequestRef.current
    const fetchDashboard = () => Promise.all([supabase.from('employee_advance_cases').select(`
      id,advance_number,amount_received,bank_reference,status,version,parent_case_id,purpose_note,holder_profile_id,source_flow_item_id,rejected_reason_code,rejected_reason_note,rejected_by,rejected_at,
      financial_transactions(recipient_name,sender_name,sender_bank_name,sender_account_last4,recipient_bank_name,recipient_account_last4,transfer_at,payment_party_confidence),
       source_flow:document_flow_items!employee_advance_cases_source_flow_item_id_fkey(id,current_flow,current_room,state,version,updated_at,target_department,candidate_departments,assignment_status),
      holder_profile:profiles!employee_advance_cases_holder_profile_id_fkey(full_name),
      holder_person:employee_people!employee_advance_cases_holder_person_id_fkey(full_name),
      employee_advance_settlement_items!employee_advance_settlement_items_case_id_fkey(id,expense_type,amount,approval_status,description,expense_date,evidence_reference),
      employee_advance_audit!employee_advance_audit_case_id_fkey(id,action,reason,created_at)
    `).eq('company_id', companyId).neq('status', 'cancelled').order('updated_at', { ascending: false }), supabase.from('employee_employment_records').select('profile_id,profiles!employee_employment_records_profile_id_fkey(full_name)').eq('company_id', companyId).eq('employment_type', 'daily').in('employment_status', ['active', 'probation', 'notice']), supabase.from('employee_money_balance_summary').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }), supabase.from('employee_money_ledger_detail_v1').select('*').eq('company_id', companyId).order('transfer_at', { ascending: false, nullsFirst: false }), supabase.from('employee_money_period_summary_v1').select('*').eq('company_id', companyId).order('pay_period_starts_on', { ascending: true }), supabase.from('employee_money_legacy_candidates').select('*').eq('company_id', companyId).order('transfer_at', { ascending: false, nullsFirst: false })] as const)
    let result = await fetchDashboard()
    for (const delayMs of [400, 900]) {
      const hasTransientError = result.some(({ error: queryError }) => /failed to fetch|networkerror|load failed/i.test(queryError?.message ?? ''))
      if (!hasTransientError) break
      await new Promise((resolve) => window.setTimeout(resolve, delayMs))
      result = await fetchDashboard()
    }
    if (requestId !== loadRequestRef.current) return
    const [{ data, error: loadError }, { data: dailyData, error: dailyError }, { data: employeeMoneyData, error: employeeMoneyError }, { data: employeeMoneyEntryData, error: employeeMoneyEntryError }, { data: periodData, error: periodError }, { data: legacyData, error: legacyError }] = result
    if (loadError || dailyError) setError(userError(loadError ?? dailyError))
    else {
      const nextRows = (data ?? []) as unknown as AdvanceCase[]
      setError('')
      setRows(nextRows)
      setSelected((current) => current ? nextRows.find((row) => row.id === current.id) ?? null : null)
      setReviewQueueIds((current) => current.filter((id) => nextRows.some((row) => row.id === id)))
      setDailyEmployees((dailyData ?? []) as unknown as DailyEmployee[])
    }
    if (employeeMoneyError || employeeMoneyEntryError || periodError || legacyError) {
      const queryError = employeeMoneyError ?? employeeMoneyEntryError ?? periodError ?? legacyError
      const transient = /failed to fetch|networkerror|load failed/i.test(queryError?.message ?? '')
      if (transient) setEmployeeMoneyWarning('เครือข่ายสะดุดระหว่างรีเฟรช ระบบเก็บข้อมูลล่าสุดไว้ กรุณากดรีเฟรชอีกครั้ง')
      else { setEmployeeMoneyRows([]); setEmployeeMoneyEntries([]); setEmployeeMoneyPeriodRows([]); setLegacyMoneyCandidates([]); setEmployeeMoneyWarning('บัญชีพักช่างยังไม่พร้อมใช้งาน กรุณาตรวจ Migration employee_money_ledger') }
    }
    else { setEmployeeMoneyRows((employeeMoneyData ?? []) as unknown as EmployeeMoneySummary[]); setEmployeeMoneyEntries((employeeMoneyEntryData ?? []) as unknown as EmployeeMoneyLedgerEntry[]); setEmployeeMoneyPeriodRows((periodData ?? []) as unknown as EmployeeMoneyPeriodSummary[]); setLegacyMoneyCandidates((legacyData ?? []) as unknown as LegacyEmployeeMoneyCandidate[]); setEmployeeMoneyWarning('') }
  }, [companyId])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])
  const openSlipPreview = useCallback(async (row: AdvanceCase) => {
    const requestId = ++previewRequestRef.current
    setSlipPreview({ status: 'loading', message: 'กำลังโหลดรูปสลิปต้นทาง...', file: null, signedUrl: null })
    setSlipPreviewDialogOpen(false)
    const sourceItemId = row.source_flow_item_id ?? row.source_flow?.id ?? null
    if (!sourceItemId) {
      setSlipPreview({ status: 'missing', message: 'ไม่พบ Document Flow Item ต้นทางที่ผูกกับรายการนี้', file: null, signedUrl: null })
      return
    }
    try {
      const preview = await documentFlowGateway.preview(sourceItemId)
      if (requestId !== previewRequestRef.current) return
      if (preview.error) {
        setSlipPreview({ status: 'error', message: `โหลดข้อมูลสลิปต้นทางไม่สำเร็จ: ${userError(preview.error)}`, file: null, signedUrl: null })
        return
      }
      const payload = preview.data as { available?: boolean; reason?: string | null; files?: PreviewFilePayload[] } | null
      const file = normalizePreviewFile(payload?.files?.[0])
      if (!file) {
        setSlipPreview({ status: 'missing', message: previewLoadMessage(payload?.reason), file: null, signedUrl: null })
        return
      }
      const signed = await documentFlowGateway.signedPreviewUrl(file.bucket, file.path)
      if (requestId !== previewRequestRef.current) return
      if (signed.error || !signed.data?.signedUrl) {
        const message = userError(signed.error)
        setSlipPreview({ status: 'error', message: previewSignedUrlErrorMessage(message), file, signedUrl: null })
        return
      }
      if (!isImageContentType(file.contentType)) {
        setSlipPreview({ status: 'non_image', message: `ไฟล์ต้นทางไม่ใช่รูป (${file.contentType ?? 'ไม่ระบุชนิดไฟล์'})`, file, signedUrl: signed.data.signedUrl })
        return
      }
      setSlipPreview({ status: 'ready', message: '', file, signedUrl: signed.data.signedUrl })
    } catch (error) {
      if (requestId !== previewRequestRef.current) return
      setSlipPreview({ status: 'error', message: `โหลดรูปสลิปไม่สำเร็จ: ${userError(error)}`, file: null, signedUrl: null })
    }
  }, [])
  useEffect(() => {
    if (!selected) {
      previewRequestRef.current += 1
      const timer = window.setTimeout(() => {
        setSlipPreview({ status: 'idle', message: 'ยังไม่ได้เลือกรายการ', file: null, signedUrl: null })
        setSlipPreviewDialogOpen(false)
      }, 0)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      void openSlipPreview(selected)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [openSlipPreview, selected])
  const total = (row: AdvanceCase) => (row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0)
  const outstanding = (row: AdvanceCase) => Number(row.amount_received) - total(row)
  const reviewQueue = reviewQueueIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is AdvanceCase => Boolean(row))
  const selectedQueueIndex = selected ? reviewQueue.findIndex((row) => row.id === selected.id) : -1
  const selectedReadiness = selected ? advanceReviewReadiness(selected) : null
  const activeRows = rows.filter((row) => row.status !== 'rejected')
  const rejectedRows = rows.filter((row) => row.status === 'rejected')
  const readyToCloseRows = activeRows.filter((row) => row.status === 'closed' || (row.status === 'approved' && advanceReviewReadiness(row).canClose))
  const actionableRows = activeRows.filter((row) => !readyToCloseRows.some((readyRow) => readyRow.id === row.id))
  const filteredActionableRows = actionableRows.filter((row) => matchesDepartment(row, departmentFilter))
  const interimAdvanceRows = canonicalEmployeeMoneyEntries(employeeMoneyEntries).filter((entry) => entry.entry_type === 'advance_issued')
  const pendingInterimAdvanceRows = interimAdvanceRows.filter((entry) => entry.entry_status === 'matched_pending_review')
  const pendingEmployeeMoneyEntries = canonicalEmployeeMoneyEntries(employeeMoneyEntries)
    .filter((entry) => entry.entry_status === 'matched_pending_review')
    .sort((left, right) => new Date(right.transfer_at ?? right.created_at).getTime() - new Date(left.transfer_at ?? left.created_at).getTime())
  const visibleInterimAdvanceRows = ['all', 'accounting', 'hr', 'needs_information'].includes(departmentFilter) ? pendingInterimAdvanceRows : []
  const actionableCount = actionableRows.length + pendingInterimAdvanceRows.length
  const periodTotals = [...employeeMoneyPeriodRows.reduce((groups, row) => {
    const current = groups.get(row.pay_period_id) ?? { id: row.pay_period_id, name: row.pay_period_name, startsOn: row.pay_period_starts_on, endsOn: row.pay_period_ends_on, entryCount: 0, pendingCount: 0, total: 0 }
    current.entryCount += Number(row.advance_entry_count)
    current.pendingCount += Number(row.pending_review_count)
    current.total += Number(row.advance_to_deduct)
    groups.set(row.pay_period_id, current)
    return groups
  }, new Map<string, { id: string; name: string; startsOn: string; endsOn: string; entryCount: number; pendingCount: number; total: number }>()).values()]
  const activeAmount = activeRows.reduce((sum, row) => sum + Number(row.amount_received), 0)
  const rejectedAmount = rejectedRows.reduce((sum, row) => sum + Number(row.amount_received), 0)
  const selectedActiveChildren = selected ? rows.filter((row) => row.parent_case_id === selected.id && !['closed', 'cancelled', 'rejected'].includes(row.status)) : []
  const closeReviewQueue = () => { setSelected(null); setReviewQueueIds([]) }
  const openReviewQueue = (queue: AdvanceCase[], initialId?: string) => {
    const actionable = queue.filter((row) => !['closed', 'cancelled', 'rejected'].includes(row.status))
    const nextQueue = actionable.length > 0 ? actionable : queue
    setReviewQueueIds(nextQueue.map((row) => row.id))
    setSelected(nextQueue.find((row) => row.id === initialId) ?? nextQueue[0] ?? null)
  }
  const moveReviewQueue = (offset: number) => {
    if (selectedQueueIndex < 0 || reviewQueue.length === 0) return
    const nextIndex = Math.min(reviewQueue.length - 1, Math.max(0, selectedQueueIndex + offset))
    setSelected(reviewQueue[nextIndex])
  }
  const addLine = async () => { if (!selected) return; setSaving(true); const { error: rpcError } = await supabase.rpc('add_employee_advance_settlement_item', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_expense_type: line.expense_type, target_amount: Number(line.amount), target_expense_date: line.expense_date, target_payee_name: null, target_project_id: null, target_work_package_id: null, target_evidence_flow_item_id: null, target_evidence_reference: line.evidence_reference || null, target_description: line.description }); setSaving(false); if (rpcError) { setError(userError(rpcError)); return }; setLineOpen(false); await load() }
  const transition = async (action: string) => { if (!selected) return; setSaving(true); const { error: rpcError } = await supabase.rpc('transition_employee_advance_case', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_action: action, target_expected_version: selected.version, target_reason: null }); setSaving(false); if (rpcError) { setError(userError(rpcError)); return }; await load() }
  const rejectCase = async () => {
    if (!selected) return
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('reject_employee_advance_case', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_expected_version: selected.version, target_reason_code: rejectReason.code, target_reason_note: rejectReason.note.trim() })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setRejectOpen(false)
    setRejectReason({ code: 'not_advance', note: '' })
    setActiveTab(3)
    await load()
  }
  const restoreCase = async () => {
    if (!selected) return
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('restore_employee_advance_case', { target_case_id: selected.id, target_event_key: crypto.randomUUID(), target_expected_version: selected.version, target_reason: restoreReason.trim() })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setRestoreOpen(false)
    setActiveTab(0)
    await load()
  }
  const createSubAdvance = async () => { if (!selected) return; setSaving(true); const { data: created, error: rpcError } = await supabase.rpc('create_employee_sub_advance', { target_parent_case_id: selected.id, target_event_key: crypto.randomUUID(), target_holder_profile_id: subAdvance.holderProfileId, target_holder_person_id: null, target_amount: Number(subAdvance.amount), target_description: subAdvance.description, target_project_id: null, target_work_package_id: null }); if (rpcError) { setSaving(false); setError(userError(rpcError)); return }; try { const delivery = await queueAdvanceConfirmation((created as { id: string }).id); setConfirmation(delivery); setError('') } catch (confirmationError) { setConfirmation(null); setError(`บันทึกรายการสำเร็จแล้ว แต่คิว MSG Confirm ยังไม่พร้อมส่ง: ${userError(confirmationError as { message?: string })}`) }; setSaving(false); setSubAdvanceOpen(false); await load() }
  const queueLegacyEmployeeMoney = async (candidate: LegacyEmployeeMoneyCandidate) => {
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('queue_legacy_employee_money_match', { target_transaction_id: candidate.financial_transaction_id, target_event_key: `legacy-employee-money:${candidate.financial_transaction_id}:${crypto.randomUUID()}` })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setError('')
    await load()
  }
  const openEmployeeMoneyReview = (entry: EmployeeMoneyLedgerEntry) => {
    setSelectedEmployeeMoneyEntryId(entry.id)
    setSelectedEmployeeMoney(employeeMoneyRows.find((row) => row.employee_profile_id === entry.employee_profile_id) ?? null)
  }
  const reviewEmployeeMoney = async (entry: EmployeeMoneyLedgerEntry, action: 'approve' | 'reject') => {
    const reason = action === 'reject' ? employeeMoneyRejectReason.trim() : null
    if (action === 'reject' && (!reason || reason.length < 3)) return
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('review_employee_money_ledger_entry', {
      target_entry_id: entry.id,
      target_event_key: `employee-money-review:${entry.id}:${action}:${crypto.randomUUID()}`,
      target_action: action,
      target_expected_version: entry.version,
      target_reason: reason,
    })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setError('')
    setEmployeeMoneyNotice(action === 'approve'
      ? `ยืนยันยอด ${money(Number(entry.amount))} แล้ว และนำออกจากคิวต้องจัดการ`
      : `Reject ยอด ${money(Number(entry.amount))} แล้ว และนำออกจากคิวต้องจัดการ`)
    setEmployeeMoneyRejectId(null)
    setEmployeeMoneyRejectReason('')
    await load()
  }
  const createEmployeeMoneyAdjustment = async () => {
    if (!adjustmentEntry) return
    setSaving(true)
    const { error: rpcError } = await supabase.rpc('create_employee_money_adjustment', {
      target_entry_id: adjustmentEntry.id,
      target_event_key: `employee-money-adjustment:${adjustmentEntry.id}:${crypto.randomUUID()}`,
      target_adjustment_type: adjustment.type,
      target_account_scope: 'advance',
      target_amount: Number(adjustment.amount),
      target_effective_on: adjustment.effectiveOn,
      target_reason: adjustment.reason.trim(),
    })
    setSaving(false)
    if (rpcError) { setError(userError(rpcError)); return }
    setError('')
    setEmployeeMoneyNotice(`บันทึก Adjustment ${money(Number(adjustment.amount))} แล้ว`)
    setAdjustmentEntry(null)
    setAdjustment({ type: 'adjustment_credit', amount: '', reason: '', effectiveOn: new Date().toLocaleDateString('en-CA') })
    await load()
  }
  return <Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><BoxTitle /><Button startIcon={<RefreshOutlined />} onClick={() => void load()}>รีเฟรช</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {employeeMoneyNotice && <Alert severity="success" onClose={() => setEmployeeMoneyNotice('')}>{employeeMoneyNotice}</Alert>}
    {confirmation && <Alert severity={['failed', 'pending_room_setup', 'room_setup_failed'].includes(confirmation.status) ? 'warning' : 'success'} onClose={() => setConfirmation(null)}><strong>System MSG Confirm: {confirmation.status === 'queued' ? 'ปิดงานแล้ว/รอส่ง MSG' : confirmation.status}</strong><br />รหัสรายการ: {confirmation.advance_case_id}<br />{confirmation.message_text}</Alert>}
    <Paper variant="outlined" sx={{ px: 1 }}><Tabs value={activeTab} onChange={(_event, value: number) => setActiveTab(value)} variant="scrollable" scrollButtons="auto">
      <Tab label={`ต้องจัดการ (${actionableCount})`} />
      <Tab label={`บัญชีพักช่างรายวัน (${employeeMoneyRows.length})`} />
      <Tab label={`พร้อมปิดยอด / ปิดแล้ว (${readyToCloseRows.length})`} />
      <Tab label={`Reject / ต้องแก้ไข (${rejectedRows.length})`} />
    </Tabs></Paper>
    {activeTab === 0 && <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption" color="text.secondary">ยอดใช้งานจริง</Typography><Typography variant="h6" sx={{ fontWeight: 800 }}>{money(activeAmount)}</Typography></Paper>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption" color="text.secondary">Reject ไม่นับยอด</Typography><Typography variant="h6" color="error" sx={{ fontWeight: 800 }}>{money(rejectedAmount)}</Typography></Paper>
      </Stack>
      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="caption" color="text.secondary">กรองตามผู้รับผิดชอบปัจจุบัน</Typography>
        <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
          {([
            ['all', `ทั้งหมด ${actionableCount}`],
            ['accounting', `รอบัญชี ${actionableRows.filter((row) => matchesDepartment(row, 'accounting')).length + pendingInterimAdvanceRows.length}`],
            ['hr', `รอ HR ${actionableRows.filter((row) => matchesDepartment(row, 'hr')).length + pendingInterimAdvanceRows.length}`],
            ['project_inventory', `รอโครงการ/คลัง ${actionableRows.filter((row) => matchesDepartment(row, 'project_inventory')).length}`],
            ['needs_information', `รอข้อมูล ${actionableRows.filter((row) => matchesDepartment(row, 'needs_information')).length + pendingInterimAdvanceRows.filter((entry) => !entry.pay_period_id).length}`],
          ] as [DepartmentFilter, string][]).map(([value, label]) => <Chip key={value} clickable color={departmentFilter === value ? 'primary' : 'default'} variant={departmentFilter === value ? 'filled' : 'outlined'} label={label} onClick={() => setDepartmentFilter(value)} />)}
        </Stack>
      </Paper>
      {visibleInterimAdvanceRows.length > 0 && <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1, mb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>เงินเบิกล่วงหน้าระหว่างงวด</Typography><Typography variant="body2" color="text.secondary">ผูกพนักงานและงวดจากวันเวลาโอนจริง · หักเมื่อปิดงวด · ยอดผิดหลังยืนยันให้แก้ด้วย Adjustment โดยไม่ลบสลิปเดิม</Typography></Box>
          <Chip color="info" label={`${visibleInterimAdvanceRows.length} รายการรอตรวจ · ${money(visibleInterimAdvanceRows.reduce((sum, entry) => sum + Number(entry.amount), 0))}`} />
        </Stack>
        {periodTotals.length > 0 && <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
          {periodTotals.map((period) => <Paper key={period.id} variant="outlined" sx={{ p: 1.25, flex: 1, minWidth: 240 }}><Typography variant="caption" color="text.secondary">{period.name}</Typography><Typography sx={{ fontWeight: 800 }}>{money(period.total)}</Typography><Typography variant="caption">{period.entryCount} รายการ · รอตรวจ {period.pendingCount}</Typography></Paper>)}
        </Stack>}
        <StandardDataTable rows={visibleInterimAdvanceRows} getRowId={(entry) => entry.id} getSearchText={(entry) => `${entry.employee_name} ${entry.received_by_name ?? ''} ${entry.bank_reference ?? ''}`} searchLabel="ค้นหาช่าง ผู้รับ หรือเลขอ้างอิง" minWidth={1260} onRowClick={(entry) => { setSelectedEmployeeMoneyEntryId(entry.id); setSelectedEmployeeMoney(employeeMoneyRows.find((summary) => summary.employee_profile_id === entry.employee_profile_id) ?? null) }} columns={[
          { id: 'date', label: 'วันที่โอน', minWidth: 170, render: (entry) => entry.transfer_at ? dateTime(entry.transfer_at) : <Chip size="small" color="warning" label="วันที่อ่านไม่ได้" /> },
          { id: 'employee', label: 'พนักงานเจ้าของยอดเบิก', minWidth: 190, render: (entry) => entry.employee_name },
          { id: 'recipient', label: 'ผู้รับเงินจริง', minWidth: 190, render: (entry) => entry.received_by_name ?? entry.recipient_name ?? '-' },
          { id: 'amount', label: 'ยอด', minWidth: 120, align: 'right', render: (entry) => money(Number(entry.amount)) },
          { id: 'period', label: 'งวดที่จะหัก', minWidth: 190, render: (entry) => entry.pay_period_name ? <Stack spacing={0.25}><Typography variant="body2">{entry.pay_period_name}</Typography><Typography variant="caption" color="success.main">{entry.pay_period_assignment_method === 'transfer_date_auto' ? 'ผูกอัตโนมัติจากวันที่โอน' : 'Admin เลือกรอบ'}</Typography></Stack> : <Chip size="small" color="warning" label="ยังไม่ผูกงวด" /> },
          { id: 'department', label: 'แผนกปัจจุบัน', minWidth: 150, render: () => 'บัญชี + HR' },
          { id: 'next', label: 'ขั้นตอนถัดไป', minWidth: 220, render: (entry) => entry.pay_period_id ? 'บัญชียืนยันยอด แล้ว HR นำไปหักเมื่อปิดงวด' : 'ผูกงวดก่อนส่งตรวจ' },
          { id: 'status', label: 'สถานะ', minWidth: 150, render: (entry) => <Chip size="small" color="warning" label={entry.pay_period_id ? 'รอยืนยันยอดเบิก' : 'รอผูกงวด'} /> },
        ]} />
      </Paper>}
      <AdvanceTreeTable rows={filteredActionableRows} onOpenQueue={openReviewQueue} />
    </Stack>}
    {activeTab === 1 && <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1, mb: 1 }}>
        <Box><Typography sx={{ fontWeight: 800 }}>บัญชีพักช่างรายวัน</Typography><Typography variant="body2" color="text.secondary">จับคู่จากสลิปด้วยชื่อมาตรฐาน · ยังไม่หัก Payroll จนกว่าจะอนุมัติ · รายการผิดแก้ด้วย Adjustment</Typography></Box>
        <Chip size="small" color="warning" label="Holding ledger / ไม่ใช่ยอดจ่าย Final" />
      </Stack>
      {employeeMoneyWarning && <Alert severity="warning" sx={{ mb: 1 }}>{employeeMoneyWarning}</Alert>}
      <Paper variant="outlined" sx={{ p: 1.25, mb: 2, bgcolor: 'rgba(237, 108, 2, 0.035)' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1, mb: 1 }}>
          <Box><Typography sx={{ fontWeight: 800 }}>คิวยืนยันยอดตามวันเวลาโอนจริง</Typography><Typography variant="body2" color="text.secondary">เรียงจากเวลาในสลิปจริง · ยืนยันหรือ Reject ทีละรายการจากจุดเดียว · ไม่สร้างรายการใหม่</Typography></Box>
          <Chip size="small" color={pendingEmployeeMoneyEntries.length > 0 ? 'warning' : 'success'} label={pendingEmployeeMoneyEntries.length > 0 ? `รอยืนยัน ${pendingEmployeeMoneyEntries.length}` : 'ยืนยันครบ'} />
        </Stack>
        <StandardDataTable rows={pendingEmployeeMoneyEntries} getRowId={(entry) => entry.id} getSearchText={(entry) => `${entry.employee_name} ${entry.sender_name ?? ''} ${entry.recipient_name ?? ''} ${entry.bank_reference ?? ''}`} searchLabel="ค้นหาช่าง ผู้โอน ผู้รับ หรือเลขอ้างอิง" minWidth={1120} onRowClick={openEmployeeMoneyReview} columns={[
          { id: 'transferAt', label: 'วันเวลาโอนจริง', minWidth: 180, render: (entry) => entry.transfer_at ? dateTime(entry.transfer_at) : <Chip size="small" color="error" label="ไม่มีเวลาโอน" /> },
          { id: 'employee', label: 'ช่างรายวัน', minWidth: 180, render: (entry) => entry.employee_name },
          { id: 'type', label: 'ประเภทยอด', minWidth: 150, render: (entry) => labels[entry.entry_type] ?? entry.entry_type },
          { id: 'sender', label: 'ผู้โอนตามสลิป', minWidth: 180, render: (entry) => entry.sender_name ?? '-' },
          { id: 'recipient', label: 'ผู้รับตามสลิป', minWidth: 180, render: (entry) => entry.recipient_name ?? entry.received_by_name ?? '-' },
          { id: 'amount', label: 'ยอด', minWidth: 120, align: 'right', render: (entry) => money(Number(entry.amount)) },
          { id: 'status', label: 'สถานะ', minWidth: 130, render: () => <Chip size="small" color="warning" label="รอยืนยัน" /> },
        ]} />
      </Paper>
      <Typography sx={{ fontWeight: 800, mb: 1 }}>ยอดรวมรายช่าง</Typography>
      <StandardDataTable rows={employeeMoneyRows} getRowId={(row) => row.employee_profile_id} getSearchText={(row) => `${row.employee_name} ${row.employee_code ?? ''}`} searchLabel="ค้นหาช่างหรือรหัสพนักงาน" minWidth={1060} onRowClick={(row) => { setSelectedEmployeeMoneyEntryId(null); setEmployeeMoneyRejectId(null); setEmployeeMoneyRejectReason(''); setSelectedEmployeeMoney(row) }} columns={[
        { id: 'employee', label: 'ช่างรายวัน', minWidth: 190, render: (row) => row.employee_name },
        { id: 'code', label: 'รหัสพนักงาน', minWidth: 130, render: (row) => row.employee_code ?? '-' },
        { id: 'advance', label: 'Advance ยืนยันแล้ว', minWidth: 150, align: 'right', render: (row) => money(Number(row.approved_advance_balance)) },
        { id: 'pendingAdvance', label: 'Advance รอตรวจ', minWidth: 150, align: 'right', render: (row) => money(Number(row.pending_advance_amount)) },
        { id: 'wagePaid', label: 'ค่าแรงจ่ายแล้ว', minWidth: 150, align: 'right', render: (row) => money(Number(row.approved_wage_paid)) },
        { id: 'pendingWage', label: 'ค่าแรงรอตรวจ', minWidth: 150, align: 'right', render: (row) => money(Number(row.pending_wage_paid)) },
        { id: 'status', label: 'สถานะ', minWidth: 130, render: (row) => <Chip size="small" color={Number(row.pending_count) > 0 ? 'warning' : 'success'} label={Number(row.pending_count) > 0 ? `รอตรวจ ${row.pending_count}` : 'ตรวจครบ'} /> },
      ]} />
      {legacyMoneyCandidates.length > 0 && <Box sx={{ mt: 2 }}>
        <Typography sx={{ fontWeight: 800, mb: 0.5 }}>สลิปเก่าที่ชื่อตรงและพร้อมเข้าบัญชีพัก</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>ระบบไม่นับสลิปซ้ำ ค่าแรงเก่าต้องผ่านบัญชียืนยันแล้ว ส่วนวันที่ผิดจะติดป้ายรอตรวจ</Typography>
        <StandardDataTable rows={legacyMoneyCandidates} getRowId={(row) => row.financial_transaction_id} getSearchText={(row) => `${row.employee_name} ${row.sender_name ?? ''} ${row.recipient_name ?? ''}`} searchLabel="ค้นหาสลิปเก่าหรือชื่อช่าง" minWidth={920} columns={[
          { id: 'employee', label: 'ช่างรายวัน', minWidth: 180, render: (row) => row.employee_name },
          { id: 'type', label: 'ประเภทเสนอ', minWidth: 150, render: (row) => row.proposed_entry_type === 'advance_issued' ? 'เงินเบิกล่วงหน้า' : 'ค่าแรงจ่ายแล้ว' },
          { id: 'amount', label: 'ยอด', minWidth: 120, align: 'right', render: (row) => money(Number(row.amount_total)) },
          { id: 'date', label: 'วันที่หลักฐาน', minWidth: 180, render: (row) => row.evidence_date_status === 'verified' ? dateTime(row.transfer_at) : <Chip size="small" color="warning" label="วันที่รอตรวจ" /> },
          { id: 'action', label: 'ดำเนินการ', minWidth: 180, render: (row) => <Button size="small" variant="outlined" disabled={!canManageAdvance || saving} onClick={() => void queueLegacyEmployeeMoney(row)}>บันทึกเข้าบัญชีพัก</Button> },
        ]} />
      </Box>}
    </Paper>}
    {activeTab === 2 && <Stack spacing={1.5}>
      <Alert severity="info">
        ค่าแรงสุทธิต้องมาจาก Payroll เมื่อปิดงวด แล้วจึงคำนวณ ค่าแรงทั้งงวด - เงินเบิกล่วงหน้า หน้านี้ไม่เปลี่ยนเงินทดรองให้เป็นค่าแรงอัตโนมัติ
      </Alert>
      {readyToCloseRows.length === 0 && <Alert severity="warning">
        ยังไม่มีงวดค่าแรงที่พร้อมปิด กรุณารอข้อมูลเวลาทำงานและยอดค่าแรงจาก Payroll ก่อน ระบบจะนำเงินเบิกล่วงหน้าที่อนุมัติแล้วไปหักในงวดเดียวกัน
      </Alert>}
      <AdvanceTreeTable
        rows={readyToCloseRows}
        onOpenQueue={openReviewQueue}
        title="สรุปค่าแรงและปิดงวด"
        description="แสดงเฉพาะเงินทดรองที่พร้อมนำไปหักเมื่อปิดงวด · ค่าแรงสุทธิจะเกิดหลัง Payroll ยืนยันยอด"
        emptyMessage="ยังไม่มีรายการพร้อมปิดงวด"
      />
    </Stack>}
    {activeTab === 3 && <Stack spacing={1.5}>
      <Alert severity="info">รายการในหน้านี้ไม่ถูกลบ และไม่รวมในยอดใช้งานจริง สามารถคลิกแถวเพื่อตรวจ Audit หรือนำกลับมาตรวจได้</Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption" color="text.secondary">ยอดใช้งานจริง</Typography><Typography variant="h6" sx={{ fontWeight: 800 }}>{money(activeAmount)}</Typography></Paper>
        <Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption" color="text.secondary">Reject ไม่นับยอด</Typography><Typography variant="h6" color="error" sx={{ fontWeight: 800 }}>{money(rejectedAmount)}</Typography></Paper>
      </Stack>
      <AdvanceTreeTable rows={rejectedRows} onOpenQueue={openReviewQueue} />
    </Stack>}
    <Drawer anchor="right" open={Boolean(selected)} onClose={closeReviewQueue} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 680 }, maxWidth: '100vw' } } }}>
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{selected?.advance_number}</Typography><Typography variant="body2" color="text.secondary">ตรวจเงินทดรองทีละรายการ พร้อมเงื่อนไขก่อนอนุมัติ</Typography></Box>
          <IconButton aria-label="ปิดรายละเอียดเงินทดรอง" onClick={closeReviewQueue}><CloseOutlined /></IconButton>
        </Stack>
        {selected && selectedReadiness && <Box sx={{ px: 2, pt: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Chip size="small" color="warning" label={`คิวตรวจ ${Math.max(selectedQueueIndex + 1, 1)}/${Math.max(reviewQueue.length, 1)}`} />
              <Chip size="small" variant="outlined" label={labels[selected.status] ?? selected.status} />
            </Stack>
            <Stack direction="row" spacing={0.5}>
              <Button size="small" startIcon={<KeyboardArrowLeftOutlined />} disabled={selectedQueueIndex <= 0} onClick={() => moveReviewQueue(-1)}>ก่อนหน้า</Button>
              <Button size="small" endIcon={<KeyboardArrowRightOutlined />} disabled={selectedQueueIndex < 0 || selectedQueueIndex >= reviewQueue.length - 1} onClick={() => moveReviewQueue(1)}>ถัดไป</Button>
            </Stack>
          </Stack>
          <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'rgba(237, 108, 2, 0.04)' }}>
            <Typography sx={{ fontWeight: 800, mb: 0.75 }}>เช็กลิสต์ก่อนดำเนินการ</Typography>
            <Stack spacing={0.6}>{selectedReadiness.checks.map((check) => <Stack key={check.label} direction="row" spacing={0.75} sx={{ alignItems: 'flex-start' }}>{check.done ? <CheckCircleOutlineOutlined color="success" fontSize="small" /> : <HourglassEmptyOutlined color="warning" fontSize="small" />}<Box><Typography variant="body2" sx={{ fontWeight: 700 }}>{check.label}</Typography><Typography variant="caption" color="text.secondary">{check.detail}</Typography></Box></Stack>)}</Stack>
            <Alert severity={selectedReadiness.canSubmit || selectedReadiness.canApprove || selectedReadiness.canClose ? 'success' : 'warning'} sx={{ mt: 1 }}>{selectedReadiness.nextAction}</Alert>
          </Paper>
          {selected.status === 'rejected' && <Alert severity="error" sx={{ mt: 1 }}>
            <strong>รายการนี้ Reject และไม่นับยอด</strong><br />
            เหตุผล: {rejectReasonLabels[selected.rejected_reason_code ?? 'other'] ?? selected.rejected_reason_code ?? '-'}{selected.rejected_reason_note ? ` · ${selected.rejected_reason_note}` : ''}<br />
            เวลา: {dateTime(selected.rejected_at)} · หลักฐานต้นฉบับและ Audit ยังอยู่ครบ
          </Alert>}
          {selected.status === 'closed' && <Alert severity="warning" sx={{ mt: 1 }}>รายการปิดยอดแล้ว ห้าม Reject ย้อนหลัง หากต้องแก้ยอดให้สร้าง Adjustment</Alert>}
          <Paper variant="outlined" sx={{ p: 1.25, mt: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>เส้นทางแผนก</Typography>
            <Typography variant="body2">แผนกปัจจุบัน: <strong>{departmentText(selected)}</strong></Typography>
            <Typography variant="body2">ขั้นตอนถัดไป: <strong>{nextActionText(selected)}</strong></Typography>
            <Typography variant="caption" color="text.secondary">สถานะรับงาน: {selected.source_flow?.assignment_status ?? 'ยังไม่ระบุ'} · รายการเดียวติดตามข้ามแผนกด้วย Source ID เดิม</Typography>
          </Paper>
        </Box>}
        <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>{selected && <CaseDetail row={selected} total={total(selected)} outstanding={outstanding(selected)} slipPreview={slipPreview} onReloadSlipPreview={() => void openSlipPreview(selected)} onOpenSlipPreviewDialog={() => setSlipPreviewDialogOpen(true)} onCloseSlipPreviewDialog={() => setSlipPreviewDialogOpen(false)} slipPreviewDialogOpen={slipPreviewDialogOpen} onPreviewImageError={() => setSlipPreview((current) => current.status === 'ready' ? { status: 'error', message: isExpiredPreviewUrlError('expired') ? 'ลิงก์รูปหมดอายุหรือเปิดไม่ได้' : 'ลิงก์รูปเปิดไม่ได้', file: current.file, signedUrl: current.signedUrl } : current)} />}</Box>
        {selected?.status === 'rejected' ? <Stack direction="row" spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button color="warning" variant="contained" startIcon={<RestoreOutlined />} disabled={saving || !canManageAdvance} onClick={() => setRestoreOpen(true)}>นำกลับมาตรวจ</Button>
        </Stack> : <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 2, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
          <Button color="error" startIcon={<DeleteOutlineOutlined />} disabled={saving || !canManageAdvance || selected?.status === 'closed'} onClick={() => setRejectOpen(true)}>Reject / ไม่นับยอด</Button><Button startIcon={<AddOutlined />} disabled={selected?.status === 'closed'} onClick={() => setSubAdvanceOpen(true)}>เบิกให้ช่าง</Button><Button startIcon={<AddOutlined />} disabled={selected?.status === 'closed'} onClick={() => setLineOpen(true)}>เพิ่มรายการใช้เงิน</Button><Button disabled={saving || !selectedReadiness?.canSubmit} onClick={() => void transition('submit')}>ส่งตรวจ</Button><Button disabled={saving || !selectedReadiness?.canApprove} onClick={() => void transition('approve')}>อนุมัติ</Button><Button disabled={saving || !selectedReadiness?.canClose} variant="contained" onClick={() => void transition('close')}>ปิดยอด</Button>
        </Stack>}
      </Stack>
    </Drawer>
    <Dialog open={rejectOpen} onClose={() => !saving && setRejectOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>ยืนยัน Reject / ไม่นับยอด</DialogTitle>
      <DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}>
        <Alert severity="warning">ยอดใช้งานจริงจะลดลง {money(Number(selected?.amount_received ?? 0))} แต่รายการต้นฉบับและ Audit จะไม่ถูกลบ</Alert>
        {selectedActiveChildren.length > 0 && <Alert severity="error">ยัง Reject ไม่ได้ เพราะมีรายการลูกที่ยังทำงานอยู่ {selectedActiveChildren.length} รายการ ต้องจัดการรายการลูกก่อน</Alert>}
        <TextField select label="เหตุผล *" value={rejectReason.code} onChange={(event) => setRejectReason({ ...rejectReason, code: event.target.value })}>{Object.entries(rejectReasonLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
        <TextField label="รายละเอียดเหตุผล *" value={rejectReason.note} onChange={(event) => setRejectReason({ ...rejectReason, note: event.target.value })} multiline minRows={2} helperText="บันทึกผู้กด เวลา เหตุผล และ Version ลง Audit" />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setRejectOpen(false)}>ยกเลิก</Button><Button color="error" variant="contained" disabled={saving || rejectReason.note.trim().length < 3 || selectedActiveChildren.length > 0} onClick={() => void rejectCase()}>ยืนยัน Reject</Button></DialogActions>
    </Dialog>
    <Dialog open={restoreOpen} onClose={() => !saving && setRestoreOpen(false)} fullWidth maxWidth="sm">
      <DialogTitle>นำรายการกลับมาตรวจ</DialogTitle><DialogContent><TextField sx={{ mt: 1 }} fullWidth label="เหตุผล *" value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} multiline minRows={2} /></DialogContent><DialogActions><Button onClick={() => setRestoreOpen(false)}>ยกเลิก</Button><Button variant="contained" disabled={saving || restoreReason.trim().length < 3} onClick={() => void restoreCase()}>นำกลับมาตรวจ</Button></DialogActions>
    </Dialog>
    <Drawer anchor="right" open={Boolean(selectedEmployeeMoney)} onClose={() => { setSelectedEmployeeMoney(null); setSelectedEmployeeMoneyEntryId(null); setEmployeeMoneyRejectId(null); setEmployeeMoneyRejectReason('') }} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 640 }, maxWidth: '100vw' } } }}>
      <Stack direction="row" sx={{ p: 2, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}><Box><Typography variant="h6" sx={{ fontWeight: 800 }}>{selectedEmployeeMoney?.employee_name}</Typography><Typography variant="body2" color="text.secondary">เงินเบิกล่วงหน้าระหว่างงวด · ค่าแรงสุทธิคำนวณเมื่อปิดงวด</Typography></Box><IconButton onClick={() => { setSelectedEmployeeMoney(null); setSelectedEmployeeMoneyEntryId(null); setEmployeeMoneyRejectId(null); setEmployeeMoneyRejectReason('') }}><CloseOutlined /></IconButton></Stack>
      <Stack spacing={1.25} sx={{ p: 2, overflowY: 'auto' }}>
        <Alert severity="info">รายการทั้งหมดมาจากหลักฐานต้นทางและยังต้องผ่าน Payroll/บัญชีก่อนหักเงินจริง รายการผิดให้ทำ Adjustment ไม่แก้ทับ Audit เดิม</Alert>
        {employeeMoneyEntries.filter((entry) => entry.employee_profile_id === selectedEmployeeMoney?.employee_profile_id).sort((left, right) => Number(right.id === selectedEmployeeMoneyEntryId) - Number(left.id === selectedEmployeeMoneyEntryId) || new Date(right.transfer_at ?? right.created_at).getTime() - new Date(left.transfer_at ?? left.created_at).getTime()).map((entry) => <Paper key={entry.id} variant="outlined" sx={{ p: 1.5, borderWidth: entry.id === selectedEmployeeMoneyEntryId ? 2 : 1, borderColor: entry.id === selectedEmployeeMoneyEntryId ? 'primary.main' : 'divider' }}><Stack spacing={1}><Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}><Box><Typography sx={{ fontWeight: 800 }}>{labels[entry.entry_type] ?? entry.entry_type}</Typography><Typography variant="body2">เจ้าของยอด: {entry.employee_name || entry.source_name}</Typography>{entry.received_by_name && entry.received_by_profile_id !== entry.employee_profile_id && <Typography variant="body2" color="info.main">ผู้รับเงินจริง: {entry.received_by_name} (รับแทน)</Typography>}</Box><Typography sx={{ fontWeight: 800 }}>{money(Number(entry.amount))}</Typography></Stack><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: .5 }}><Typography variant="body2"><strong>วันเวลาโอนจริง:</strong> {entry.transfer_at ? new Date(entry.transfer_at).toLocaleString('th-TH') : 'ยังอ่านไม่ได้'}</Typography><Typography variant="body2"><strong>เลขอ้างอิง:</strong> {entry.bank_reference || '-'}</Typography><Typography variant="body2"><strong>จาก:</strong> {entry.sender_name || '-'} {entry.sender_bank_name ? `· ${entry.sender_bank_name}` : ''} {entry.sender_account_last4 ? `•••• ${entry.sender_account_last4}` : ''}</Typography><Typography variant="body2"><strong>ถึง:</strong> {entry.recipient_name || '-'} {entry.recipient_bank_name ? `· ${entry.recipient_bank_name}` : ''} {entry.recipient_account_last4 ? `•••• ${entry.recipient_account_last4}` : ''}</Typography><Typography variant="body2" sx={{ gridColumn: { sm: '1 / -1' } }}><strong>งวดที่จะหัก:</strong> {entry.pay_period_name ? `${entry.pay_period_name} (${entry.pay_period_status})` : 'ยังไม่ผูกงวด'}</Typography></Box><Typography variant="caption" color="text.secondary">สถานะ {entry.entry_status} · วันที่หลักฐาน {entry.evidence_date_status} · Version {entry.version} · จับคู่ด้วย {entry.match_method}{entry.reason ? ` · ${entry.reason}` : ''}</Typography>{entry.entry_status === 'matched_pending_review' && <Stack spacing={1}>{!entry.transfer_at || entry.evidence_date_status !== 'verified' ? <Alert severity="warning">ยังยืนยันไม่ได้จนกว่าจะมีวันเวลาโอนจริงและหลักฐานผ่านการตรวจ</Alert> : null}{employeeMoneyRejectId === entry.id && <TextField size="small" label="เหตุผล Reject *" value={employeeMoneyRejectReason} onChange={(event) => setEmployeeMoneyRejectReason(event.target.value)} multiline minRows={2} helperText="เหตุผลจะถูก append ลง Audit และไม่ลบหลักฐานเดิม" />}<Stack direction="row" spacing={1}><Button variant="contained" color="success" disabled={!canManageAdvance || saving || !entry.transfer_at || entry.evidence_date_status !== 'verified'} onClick={() => void reviewEmployeeMoney(entry, 'approve')}>ยืนยันยอดนี้</Button>{employeeMoneyRejectId === entry.id ? <Button color="error" variant="contained" disabled={!canManageAdvance || saving || employeeMoneyRejectReason.trim().length < 3} onClick={() => void reviewEmployeeMoney(entry, 'reject')}>ยืนยัน Reject</Button> : <Button color="error" disabled={!canManageAdvance || saving} onClick={() => { setEmployeeMoneyRejectId(entry.id); setEmployeeMoneyRejectReason('') }}>Reject</Button>}</Stack></Stack>}{entry.entry_status !== 'matched_pending_review' && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Chip size="small" color={entry.entry_status === 'approved' ? 'success' : 'default'} label={entry.entry_status === 'approved' ? 'ยืนยันแล้ว' : labels[entry.entry_status] ?? entry.entry_status} />{entry.entry_status === 'approved' && entry.account_scope === 'advance' && <Button size="small" disabled={!canManageAdvance || saving} onClick={() => { setAdjustmentEntry(entry); setAdjustment({ type: 'adjustment_credit', amount: '', reason: '', effectiveOn: entry.effective_on ?? new Date().toLocaleDateString('en-CA') }) }}>สร้าง Adjustment</Button>}</Stack>}</Stack></Paper>)}
        {!employeeMoneyEntries.some((entry) => entry.employee_profile_id === selectedEmployeeMoney?.employee_profile_id) && <Alert severity="warning">ยังไม่มี Detail ย่อยของช่างรายนี้</Alert>}
      </Stack>
    </Drawer>
    <Dialog open={Boolean(adjustmentEntry)} onClose={() => setAdjustmentEntry(null)} fullWidth maxWidth="sm">
      <DialogTitle>สร้าง Adjustment เงินเบิกล่วงหน้า</DialogTitle>
      <DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}>
        <Alert severity="info">ไม่แก้หรือลบสลิปเดิม ระบบจะสร้างรายการปรับปรุงและผูกงวดตามวันที่</Alert>
        <TextField select label="วิธีปรับยอด" value={adjustment.type} onChange={(event) => setAdjustment({ ...adjustment, type: event.target.value })}><MenuItem value="adjustment_credit">ลดยอดที่ต้องหัก</MenuItem><MenuItem value="adjustment_debit">เพิ่มยอดที่ต้องหัก</MenuItem></TextField>
        <TextField type="number" label="จำนวนเงิน" value={adjustment.amount} onChange={(event) => setAdjustment({ ...adjustment, amount: event.target.value })} />
        <TextField type="date" label="วันที่มีผล" value={adjustment.effectiveOn} onChange={(event) => setAdjustment({ ...adjustment, effectiveOn: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="เหตุผล *" value={adjustment.reason} onChange={(event) => setAdjustment({ ...adjustment, reason: event.target.value })} multiline minRows={2} />
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setAdjustmentEntry(null)}>ยกเลิก</Button><Button variant="contained" disabled={saving || Number(adjustment.amount) <= 0 || adjustment.reason.trim().length < 3 || !adjustment.effectiveOn} onClick={() => void createEmployeeMoneyAdjustment()}>บันทึก Adjustment</Button></DialogActions>
    </Dialog>
    <Dialog open={lineOpen} onClose={() => setLineOpen(false)} fullWidth maxWidth="sm"><DialogTitle>เพิ่มรายการใช้เงิน</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField select label="ประเภท" value={line.expense_type} onChange={(event) => setLine({ ...line, expense_type: event.target.value })}>{['daily_wage', 'materials', 'travel', 'other', 'cash_return', 'payroll_offset'].map((value) => <MenuItem key={value} value={value}>{labels[value]}</MenuItem>)}</TextField><TextField type="number" label="จำนวนเงิน" value={line.amount} onChange={(event) => setLine({ ...line, amount: event.target.value })} /><TextField type="date" label="วันที่" value={line.expense_date} onChange={(event) => setLine({ ...line, expense_date: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} /><TextField label="รายละเอียด" value={line.description} onChange={(event) => setLine({ ...line, description: event.target.value })} /><TextField label="เลขอ้างอิงหลักฐาน" value={line.evidence_reference} onChange={(event) => setLine({ ...line, evidence_reference: event.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setLineOpen(false)}>ยกเลิก</Button><Button disabled={saving || !line.amount || line.description.trim().length < 3} variant="contained" onClick={() => void addLine()}>บันทึก</Button></DialogActions></Dialog>
    <Dialog open={subAdvanceOpen} onClose={() => setSubAdvanceOpen(false)} fullWidth maxWidth="sm"><DialogTitle>สร้างเงินเบิกล่วงหน้าให้ช่าง</DialogTitle><DialogContent><Stack spacing={1.5} sx={{ pt: 1 }}><TextField select label="ช่าง/พนักงานรายวัน" value={subAdvance.holderProfileId} onChange={(event) => setSubAdvance({ ...subAdvance, holderProfileId: event.target.value })}>{dailyEmployees.map((employee) => <MenuItem key={employee.profile_id} value={employee.profile_id}>{employee.profiles?.full_name ?? employee.profile_id}</MenuItem>)}</TextField><TextField type="number" label="จำนวนเงิน" value={subAdvance.amount} onChange={(event) => setSubAdvance({ ...subAdvance, amount: event.target.value })} /><TextField label="รายละเอียดงาน/เหตุผล" value={subAdvance.description} onChange={(event) => setSubAdvance({ ...subAdvance, description: event.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setSubAdvanceOpen(false)}>ยกเลิก</Button><Button disabled={saving || !subAdvance.holderProfileId || !subAdvance.amount || subAdvance.description.trim().length < 3} variant="contained" onClick={() => void createSubAdvance()}>สร้างเงินเบิก</Button></DialogActions></Dialog>
  </Stack>
}

function CaseDetail({
  row,
  total,
  outstanding,
  slipPreview,
  slipPreviewDialogOpen,
  onOpenSlipPreviewDialog,
  onCloseSlipPreviewDialog,
  onReloadSlipPreview,
  onPreviewImageError,
}: {
  row: AdvanceCase
  total: number
  outstanding: number
  slipPreview: PreviewState
  slipPreviewDialogOpen: boolean
  onOpenSlipPreviewDialog: () => void
  onCloseSlipPreviewDialog: () => void
  onReloadSlipPreview: () => void
  onPreviewImageError: () => void
}) {
  const source = row.financial_transactions
  const sourceFlowId = row.source_flow?.id ?? row.source_flow_item_id ?? '-'
  const nodes = flowNodes(row)
  const [auditNode, setAuditNode] = useState<FlowNode | null>(null)
  return <Stack spacing={2}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Chip color={updateState(row).color} label={updateState(row).label} /><Chip color={sourceQuality(row).color} label={sourceQuality(row).label} /></Stack>
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography sx={{ fontWeight: 700 }}>ข้อมูลเงินสำรองจ่าย</Typography>
      <Typography>ผู้ถือเงิน: {holderName(row)} · รับมา {money(Number(row.amount_received))} · ใช้จ่ายอนุมัติ {money(total)} · คงค้าง {money(outstanding)}</Typography>
      <Typography variant="body2" color="text.secondary">{row.purpose_note ?? '-'}</Typography>
    </Paper>
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography sx={{ fontWeight: 700 }}>เส้นทางเอกสาร</Typography>
      <Typography>{sourceRoute(row)}</Typography>
      <Typography variant="body2" color="text.secondary">Document ID: {sourceFlowId}</Typography>
      <Typography variant="body2" color="text.secondary">Version: {row.source_flow?.version ?? row.version}</Typography>
      {row.source_flow && <Typography variant="body2" color="text.secondary">สถานะทะเบียนกลาง: {row.source_flow.current_flow} / {row.source_flow.current_room} / {row.source_flow.state}</Typography>}
    </Paper>
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box><Typography sx={{ fontWeight: 700 }}>Document Flow</Typography><Typography variant="caption" color="text.secondary">คลิกแต่ละขั้นเพื่อดู Audit รายละเอียด</Typography></Box>
        <Chip size="small" label={`Advance ID: ${row.id}`} />
      </Stack>
      <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 1 }}>
        {nodes.map((node, index) => <Box key={node.key} sx={{ display: 'flex', alignItems: 'center', minWidth: 150 }}>
          <ButtonBase onClick={() => setAuditNode(node)} sx={{ display: 'block', textAlign: 'left', borderRadius: 1, width: '100%', p: 0.75, border: 1, borderColor: `${flowStatusColor(node.status)}.main`, bgcolor: node.status === 'passed' ? 'success.50' : node.status === 'rejected' ? 'error.50' : node.status === 'waiting' ? 'warning.50' : 'grey.50' }}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><FlowStatusIcon status={node.status} /><Typography variant="caption" sx={{ fontWeight: 800 }}>{node.label}</Typography></Stack>
            <Typography variant="caption" color={`${flowStatusColor(node.status)}.main`} sx={{ display: 'block', fontWeight: 700 }}>{flowStatusLabel(node.status)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{dateTime(node.time)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.owner}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.documentId}</Typography>
          </ButtonBase>
          {index < nodes.length - 1 && <Typography aria-hidden sx={{ px: 0.5, color: 'text.disabled', fontWeight: 800 }}>→</Typography>}
        </Box>)}
      </Box>
    </Paper>
        {source && <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography sx={{ fontWeight: 700 }}>หลักฐานสลิปต้นทาง</Typography>
      <Typography variant="body2">ผู้โอน: {source.sender_name ?? '-'} · {source.sender_bank_name ?? '-'} · •••• {source.sender_account_last4 ?? '-'}</Typography>
      <Typography variant="body2">ผู้รับที่อ่านจากสลิป: {source.recipient_name ?? '-'} · {source.recipient_bank_name ?? '-'} · •••• {source.recipient_account_last4 ?? '-'}</Typography>
      <Typography variant="body2">เวลาโอน: {dateTime(source.transfer_at)} · อ้างอิง: {row.bank_reference ?? '-'}</Typography>
      <Typography variant="body2" color="text.secondary">Source route: {sourceRoute(row)}</Typography>
      <Stack spacing={1} sx={{ mt: 1.25 }}>
        {slipPreview.status === 'loading' && <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><CircularProgress size={18} /><Typography variant="body2">{slipPreview.message}</Typography></Stack>}
        {slipPreview.status === 'missing' && <Alert severity={previewSeverity(slipPreview.status)} action={<Button size="small" onClick={onReloadSlipPreview}>ลองใหม่</Button>}>{slipPreview.message}</Alert>}
        {slipPreview.status === 'error' && <Alert severity={previewSeverity(slipPreview.status)} action={<Button size="small" onClick={onReloadSlipPreview}>ลองใหม่</Button>}>{slipPreview.message}</Alert>}
        {slipPreview.status === 'non_image' && <Alert severity={previewSeverity(slipPreview.status)} action={<Button size="small" component="a" href={slipPreview.signedUrl ?? '#'} target="_blank" rel="noreferrer">เปิดไฟล์เต็ม</Button>}>{slipPreview.message}</Alert>}
        {slipPreview.status === 'ready' && <Stack spacing={1}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" component="a" href={slipPreview.signedUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewOutlined />}>เปิดไฟล์เต็ม</Button>
            <Button variant="contained" onClick={onOpenSlipPreviewDialog}>ดูภาพเต็ม</Button>
            <Button variant="text" onClick={onReloadSlipPreview}>โหลดลิงก์ใหม่</Button>
          </Stack>
          <Box
            component="img"
            src={slipPreview.signedUrl ?? ''}
            alt={`สลิปต้นทาง ${row.advance_number}`}
            onClick={onOpenSlipPreviewDialog}
            onError={onPreviewImageError}
            sx={{ width: '100%', maxHeight: 360, objectFit: 'contain', bgcolor: 'grey.100', borderRadius: 1, cursor: 'zoom-in' }}
          />
        </Stack>}
      </Stack>
    </Paper>}
    <Box><Typography sx={{ fontWeight: 700, mb: 1 }}>Timeline อัตโนมัติ (รายการเดิม)</Typography>{buildAdvanceAuditTimeline(row.employee_advance_audit ?? []).map((audit) => { const attemptLabel = advanceAuditAttemptLabel(audit); return <Paper key={audit.id} variant="outlined" sx={{ p: 1, mb: 0.75 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Typography>{labels[audit.action] ?? audit.action}</Typography>{attemptLabel && <Chip size="small" color={audit.retryNumber === null ? 'default' : 'warning'} label={attemptLabel} />}</Stack><Typography variant="caption" color="text.secondary">{dateTime(audit.created_at)}{audit.reason ? ` · ${audit.reason}` : ''}</Typography></Paper> })}</Box>
    <Box><Typography sx={{ fontWeight: 700, mb: 1 }}>รายการจ่าย/หลักฐาน</Typography>{(row.employee_advance_settlement_items ?? []).length > 0 ? (row.employee_advance_settlement_items ?? []).map((item) => <Paper key={item.id} variant="outlined" sx={{ p: 1, mb: 0.75 }}><Typography>{labels[item.expense_type] ?? item.expense_type} · {money(Number(item.amount))} · {labels[item.approval_status] ?? item.approval_status}</Typography><Typography variant="caption">{item.expense_date} · {item.description}{item.evidence_reference ? ` · หลักฐาน ${item.evidence_reference}` : ''}</Typography></Paper>) : <Typography variant="body2" color="text.secondary">ยังไม่มีรายการจ่ายที่บันทึกสำหรับเงินทดรองนี้</Typography>}</Box>
    <Dialog open={slipPreviewDialogOpen && slipPreview.status === 'ready'} onClose={onCloseSlipPreviewDialog} fullWidth maxWidth="xl">
      <DialogTitle>รูปสลิปต้นทาง · {row.advance_number}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            Document ID: {sourceFlowId} · Version: {row.source_flow?.version ?? row.version} · {sourceRoute(row)}
          </Typography>
          <Box
            component="img"
            src={slipPreview.signedUrl ?? ''}
            alt={`สลิปต้นทาง ${row.advance_number} แบบเต็ม`}
            onError={onPreviewImageError}
            sx={{ width: '100%', maxHeight: '78vh', objectFit: 'contain', bgcolor: 'grey.100', borderRadius: 1 }}
          />
          {slipPreview.status !== 'ready' && <Alert severity="warning">ลิงก์รูปหมดอายุหรือเปิดไม่ได้ กรุณาโหลดใหม่จากรายละเอียดรายการ</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button component="a" href={slipPreview.signedUrl ?? '#'} target="_blank" rel="noreferrer" endIcon={<OpenInNewOutlined />}>เปิดไฟล์เต็ม</Button>
        <Button onClick={onCloseSlipPreviewDialog}>ปิด</Button>
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(auditNode)} onClose={() => setAuditNode(null)} fullWidth maxWidth="sm">
      <DialogTitle><Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}><span>Audit · {auditNode?.label}</span><IconButton aria-label="ปิดรายละเอียด Audit" onClick={() => setAuditNode(null)}><CloseRounded /></IconButton></Stack></DialogTitle>
      <DialogContent dividers>
        {auditNode && <Stack spacing={1.25}>
          <Chip size="small" color={flowStatusColor(auditNode.status)} label={`${flowStatusLabel(auditNode.status)} · ${auditNode.detail}`} />
          <Typography variant="body2">Document ID: {auditNode.documentId}</Typography>
          <Typography variant="body2">Advance ID: {row.id}</Typography>
          <Typography variant="body2">ผู้รับผิดชอบ: {auditNode.owner}</Typography>
          {auditNode.audit.length ? buildAdvanceAuditTimeline(auditNode.audit).reverse().map((audit) => { const attemptLabel = advanceAuditAttemptLabel(audit); return <Paper key={audit.id} variant="outlined" sx={{ p: 1 }}><Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Typography sx={{ fontWeight: 700 }}>{labels[audit.action] ?? audit.action}</Typography>{attemptLabel && <Chip size="small" color={audit.retryNumber === null ? 'default' : 'warning'} label={attemptLabel} />}</Stack><Typography variant="caption" color="text.secondary">{dateTime(audit.created_at)} · ผู้ดำเนินการ: ระบบ/ไม่ระบุจาก audit{audit.reason ? ` · เหตุผล: ${audit.reason}` : ''}</Typography></Paper> }) : <Typography variant="body2" color="text.secondary">ยังไม่มี Audit รายละเอียดสำหรับขั้นตอนนี้</Typography>}
        </Stack>}
      </DialogContent>
      <DialogActions><Button onClick={() => setAuditNode(null)}>ปิด</Button></DialogActions>
    </Dialog>
  </Stack>
}
function AdvanceTreeTable({ rows, onOpenQueue, title = 'เงินสำรองจ่ายตามช่าง', description = 'คลิกแถวเพื่อเปิดรายละเอียด · กดลูกศรเพื่อแตกดูแต่ละครั้ง', emptyMessage = 'ไม่พบรายการตามเงื่อนไขค้นหา' }: { rows: AdvanceCase[]; onOpenQueue: (rows: AdvanceCase[], initialId?: string) => void; title?: string; description?: string; emptyMessage?: string }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const groups = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const filtered = keyword
      ? rows.filter((row) => `${holderName(row)} ${row.advance_number} ${row.bank_reference ?? ''} ${routeText(row)}`.toLowerCase().includes(keyword))
      : rows
    const grouped = new Map<string, AdvanceTreeGroup>()
    for (const row of filtered) {
      const employeeName = holderName(row)
      const key = (row.holder_profile_id ?? employeeName.trim().toLowerCase()) || row.id
      const current = grouped.get(key) ?? { key, employeeName, rows: [], received: 0, approvedUsed: 0, outstanding: 0 }
      current.rows.push(row)
      current.received += Number(row.amount_received)
      current.approvedUsed += (row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0)
      current.outstanding += Number(row.amount_received) - (row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0)
      grouped.set(key, current)
    }
    return [...grouped.values()].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'th'))
  }, [rows, search])
  const visibleGroups = groups.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  const totals = groups.reduce((sum, group) => ({
    count: sum.count + group.rows.length,
    received: sum.received + group.received,
    approvedUsed: sum.approvedUsed + group.approvedUsed,
    outstanding: sum.outstanding + group.outstanding,
  }), { count: 0, received: 0, approvedUsed: 0, outstanding: 0 })
  const toggle = (key: string) => setExpanded((current) => ({ ...current, [key]: !current[key] }))
  return <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 1.5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
      <Box><Typography sx={{ fontWeight: 800 }}>{title}</Typography><Typography variant="body2" color="text.secondary">{description}</Typography></Box>
      <TextField size="small" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="ค้นหาช่างหรือ Advance ID" slotProps={{ htmlInput: { 'aria-label': 'ค้นหาช่างหรือ Advance ID' } }} sx={{ minWidth: { sm: 280 } }} />
    </Stack>
    <TableContainer sx={{ maxHeight: { xs: 'calc(100vh - 260px)', md: 'calc(100vh - 330px)' } }}>
      <Table size="small" stickyHeader sx={{ minWidth: 1320 }}>
        <TableHead><TableRow>
          <TableCell sx={{ fontWeight: 700, minWidth: 280 }}>ช่าง / รายการ</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>จำนวนรายการ</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>Advance รวม</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>ใช้จ่ายอนุมัติ</TableCell>
          <TableCell align="right" sx={{ fontWeight: 700 }}>คงค้าง</TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>แผนกปัจจุบัน</TableCell>
          <TableCell sx={{ fontWeight: 700, minWidth: 230 }}>ขั้นตอนถัดไป</TableCell>
          <TableCell sx={{ fontWeight: 700 }}>สถานะ</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {visibleGroups.map((group) => {
            const isOpen = expanded[group.key] ?? false
            const pendingCount = group.rows.filter((row) => !['closed', 'cancelled', 'rejected'].includes(row.status)).length
            return <Fragment key={group.key}>
              <TableRow hover onClick={() => onOpenQueue(group.rows)} sx={{ bgcolor: 'rgba(166, 89, 64, 0.06)', cursor: 'pointer' }}>
                <TableCell><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><IconButton size="small" aria-label={`${isOpen ? 'ยุบ' : 'ขยาย'} รายการของ ${group.employeeName}`} onClick={(event) => { event.stopPropagation(); toggle(group.key) }}>{isOpen ? <KeyboardArrowDownOutlined /> : <KeyboardArrowRightOutlined />}</IconButton><Typography sx={{ fontWeight: 800 }}>{group.employeeName}</Typography></Stack></TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{group.rows.length}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{money(group.received)}</TableCell>
                <TableCell align="right">{money(group.approvedUsed)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{money(group.outstanding)}</TableCell>
                <TableCell>{[...new Set(group.rows.flatMap(rowDepartments))].map((department) => departmentLabels[department] ?? department).join(', ')}</TableCell>
                <TableCell>{group.rows.length === 1 ? nextActionText(group.rows[0]) : 'เปิดรายการเพื่อดูขั้นตอนของแต่ละยอด'}</TableCell>
                <TableCell><Chip size="small" color={group.rows.every((row) => row.status === 'rejected') ? 'error' : pendingCount ? 'warning' : 'success'} label={group.rows.every((row) => row.status === 'rejected') ? `Reject ${group.rows.length}` : pendingCount ? `รอตรวจ ${pendingCount}` : 'ตรวจครบ'} /></TableCell>
              </TableRow>
              {isOpen && group.rows.map((row) => <TableRow key={row.id} hover onClick={() => onOpenQueue(group.rows, row.id)} sx={{ bgcolor: 'grey.50', cursor: 'pointer' }}>
                <TableCell sx={{ pl: 7 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{row.advance_number}</Typography><Typography variant="caption" color="text.secondary">{dateTime(row.financial_transactions?.transfer_at)} · {row.bank_reference ?? 'ไม่มีเลขอ้างอิง'}</Typography></TableCell>
                <TableCell align="right">1</TableCell>
                <TableCell align="right">{money(Number(row.amount_received))}</TableCell>
                <TableCell align="right">{money((row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0))}</TableCell>
                <TableCell align="right">{money(Number(row.amount_received) - (row.employee_advance_settlement_items ?? []).filter((item) => item.approval_status === 'approved').reduce((sum, item) => sum + Number(item.amount), 0))}</TableCell>
                <TableCell>{departmentText(row)}</TableCell>
                <TableCell>{nextActionText(row)}</TableCell>
                <TableCell><Chip size="small" color={row.status === 'rejected' ? 'error' : row.status === 'approved' || row.status === 'closed' ? 'success' : 'warning'} label={labels[row.status] ?? row.status} /></TableCell>
              </TableRow>)}
            </Fragment>
          })}
          {!visibleGroups.length && <TableRow><TableCell colSpan={8}><Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{emptyMessage}</Typography></TableCell></TableRow>}
          <TableRow sx={{ bgcolor: 'rgba(166, 89, 64, 0.12)' }}>
            <TableCell sx={{ fontWeight: 800 }}>รวมทั้งหมด</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{totals.count} รายการ</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{money(totals.received)}</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{money(totals.approvedUsed)}</TableCell><TableCell align="right" sx={{ fontWeight: 800 }}>{money(totals.outstanding)}</TableCell><TableCell colSpan={3}><Typography variant="caption" color="text.secondary">ยอดจากผลค้นหาปัจจุบัน</Typography></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
    <TablePagination component="div" count={groups.length} page={Math.min(page, Math.max(0, Math.ceil(groups.length / rowsPerPage) - 1))} rowsPerPage={rowsPerPage} rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="ช่างต่อหน้า" onPageChange={(_event, nextPage) => setPage(nextPage)} onRowsPerPageChange={(event) => { setRowsPerPage(Number(event.target.value)); setPage(0) }} />
  </Paper>
}
function BoxTitle() { return <Box><Typography variant="h5" sx={{ fontWeight: 800 }}>เงินทดรองและปิดยอด</Typography><Typography variant="body2" color="text.secondary">สลิปต้นทาง → รายการใช้เงิน → หลักฐาน → อนุมัติ → ปิดยอด</Typography></Box> }
