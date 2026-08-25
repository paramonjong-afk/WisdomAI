import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Chip, Divider, Drawer, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import {
  isEmployeeResigned,
  employmentStatusColor,
  employmentStatusLabel,
} from '../../utils/employeeLifecycle'
import { parseFunctionError, toFriendlyError, type StandardErrorPayload } from '../../utils/error-center'
import { createAttemptStore, createSignature, generateAttemptId, globalMutationAttemptStore, summarizePreflight, toPreflightResult, type OperationAttemptRecord, type OperationIssue } from '../../utils/operation-center'
import { summarizeCreateEmployeeIssues, validateCreateEmployeePayload } from '../../utils/create-employee-validation'
import { invokeHrMutation } from '../../services/hrMutationGateway'
import { documentFlowGateway } from '../../services/documentFlowGateway'

type Employee = {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'manager' | 'employee'
  membership_active?: boolean | null
  company_role?: string
  employee_code?: string | null
  employment_type?: string | null
  job_title?: string | null
  department?: string | null
  employment_status?: string | null
  attendance_policy?: string | null
  work_policy_id?: string | null
  site_count?: number
  has_work_policy?: boolean
  ready_to_clock?: boolean
}
type EmployeeIntakeMaster = {
  id: string
  source_intake_id: string | null
  employee_code: string
  full_name: string
  employment_type: string
  employee_status: string
  created_at: string
  phone: string | null
  position: string | null
  start_date: string | null
  intake_status: string | null
  missing_fields: string[]
  documents: Array<{ id: string; employee_person_id: string; document_type: string; link_status: string }>
}
type EmployeePersonDocument = { id: string; employee_person_id: string; document_type: string; link_status: string }
type IntakeEmployeeDraft = { full_name: string; phone: string; employment_type: string; position: string; start_date: string }
type WorkPolicyOption = { id: string; name: string; active: boolean }
type CreateEmployeeError = StandardErrorPayload & { request_id?: string }
type CreateEmployeeErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
  | 'INVALID_PASSWORD'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'AUTH_CREATE_FAILED'
  | 'CONSTRAINT_VIOLATION'
  | 'DUPLICATE_RECORD'
  | 'UNHANDLED'
  | 'UNKNOWN_ERROR'
type CreateEmployeeSuccess = {
  request_id?: string
  ok: true
  dry_run?: false
  employee: {
    id: string
    email: string
    full_name: string
    role: 'employee' | 'manager'
    company_id: string
  }
}
type ManageEmployeeResponse = {
  ok?: boolean
  error?: string
  error_code?: string
  warning?: string
}
type CreateEmployeeDryRunPlan = {
  actor_id: string
  input_email: string
  input_full_name: string
  input_role: 'employee' | 'manager'
  company_id: string
  membership_role: 'employee' | 'manager'
  employment_defaults: {
    employment_type: string
    employment_status: string
    daily_rate: number
    monthly_salary: number
    overtime_hourly_rate: number
  }
  will_write: false
  preview_note: string
}
type CreateEmployeeDryRunSuccess = {
  request_id?: string
  ok: true
  dry_run: true
  plan: CreateEmployeeDryRunPlan
}
type EmploymentForm = {
  employee_code: string; employment_type: string; job_title: string; department: string
  hired_on: string; probation_ends_on: string; contract_ends_on: string
  employment_status: string; attendance_policy: string; work_policy_id: string
  daily_rate: string; monthly_salary: string; overtime_hourly_rate: string
}

const toCreateEmployeeCode = (code: string | undefined): CreateEmployeeErrorCode => {
  if (!code) return 'UNKNOWN_ERROR'
  if (code === 'INVALID_EMAIL'
    || code === 'INVALID_NAME'
    || code === 'INVALID_PASSWORD'
    || code === 'AUTH_REQUIRED'
    || code === 'PERMISSION_DENIED'
    || code === 'EMAIL_ALREADY_EXISTS'
    || code === 'AUTH_CREATE_FAILED'
    || code === 'CONSTRAINT_VIOLATION'
    || code === 'DUPLICATE_RECORD'
    || code === 'UNHANDLED'
    || code === 'UNKNOWN_ERROR') return code
  return 'UNKNOWN_ERROR'
}

const toStandardErrorPayload = (value: unknown): StandardErrorPayload | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.error !== 'string' || typeof candidate.error_code !== 'string') return null
  return {
    error: candidate.error,
    error_code: candidate.error_code,
    action: typeof candidate.action === 'string' ? candidate.action : undefined,
  }
}

const getCreateEmployeeRecoverySuggestion = (code: CreateEmployeeErrorCode | undefined) => {
  if (!code) return ''
  if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_DENIED') return 'กดปุ่ม “ออก/เข้าสู่ระบบใหม่” เพื่อรีเฟรชสิทธิ์ทันที'
  if (code === 'EMAIL_ALREADY_EXISTS') return 'กดปุ่ม “เปลี่ยนอีเมล” แล้วกรอกอีเมลใหม่ แล้วลองอีกครั้ง'
  if (code === 'DUPLICATE_RECORD') return 'กรุณาเปลี่ยนอีเมล แล้วลองส่งใหม่อีกครั้ง'
  if (code === 'INVALID_EMAIL') return 'กดปุ่ม “เช็ครูปแบบอีเมล” เพื่อตรวจรูปแบบและลองอีกครั้ง'
  if (code === 'INVALID_NAME') return 'กดปุ่ม “ตั้งชื่อใหม่” เพื่อแก้ชื่อตามรูปแบบที่ระบบรับได้'
  if (code === 'INVALID_PASSWORD') return 'กดปุ่ม “ตั้งรหัสใหม่” โดยใช้รหัสผ่านอย่างน้อย 10 ตัวอักษร'
  return 'กดปุ่ม “ลองอีกครั้ง” โดยคงข้อมูลเดิมหรือแก้ไขข้อมูลที่ยังค้างก่อนส่งใหม่'
}

const getCreateEmployeeRecoveryButtonLabel = (code: CreateEmployeeErrorCode | undefined) => {
  if (!code) return 'ลองอีกครั้ง'
  if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_DENIED') return 'ออก/เข้าสู่ระบบใหม่'
  if (code === 'EMAIL_ALREADY_EXISTS') return 'เปลี่ยนอีเมล'
  if (code === 'DUPLICATE_RECORD') return 'เปลี่ยนอีเมล'
  if (code === 'INVALID_EMAIL') return 'เช็ครูปแบบอีเมล'
  if (code === 'INVALID_NAME') return 'ตั้งชื่อใหม่'
  if (code === 'INVALID_PASSWORD') return 'ตั้งรหัสใหม่'
  return 'ลองอีกครั้ง'
}

const emptyEmployment: EmploymentForm = {
  employee_code: '', employment_type: 'daily', job_title: '', department: '',
  hired_on: '', probation_ends_on: '', contract_ends_on: '', employment_status: 'active', attendance_policy: 'required', work_policy_id: '',
  daily_rate: '0', monthly_salary: '0', overtime_hourly_rate: '0',
}
const employmentLabels:Record<string,string>={daily:'รายวัน',monthly:'รายเดือน',temporary:'ชั่วคราว',contractor:'ผู้รับเหมา'}
const intakeDocumentLabels: Record<string, string> = {
  thai_national_id: 'บัตรประชาชน', driving_license: 'ใบขับขี่', house_registration: 'ทะเบียนบ้าน',
  education_certificate: 'วุฒิการศึกษา', bank_evidence: 'หลักฐานบัญชีธนาคาร',
  portrait: 'รูปถ่าย', other: 'เอกสารอื่น', unknown: 'รอระบุประเภท',
}
const employeeMissingData = (employee: Employee) => [
  !employee.employment_type && 'ประเภทการจ้าง',
  employee.attendance_policy !== 'exempt' && !employee.has_work_policy && 'ตารางเวลาทำงาน',
  (employee.site_count ?? 0) < 1 && 'ไซต์งาน',
].filter(Boolean) as string[]

const isEmployeeTerminated = (employee: Employee) =>
  isEmployeeResigned({ employment_status: employee.employment_status, membership_active: employee.membership_active })

const companyRoleLabel = (companyRole?: string) => {
  if (!companyRole) return 'ไม่ระบุกลุ่มสิทธิ์'
  if (companyRole === 'company_admin') return 'ผู้ดูแลบริษัท'
  if (companyRole === 'executive') return 'ผู้บริหาร'
  if (companyRole === 'manager') return 'ผู้จัดการ'
  if (companyRole === 'site_supervisor') return 'หัวหน้างาน'
  if (companyRole === 'accounting_hr') return 'ฝ่ายบัญชี/HR'
  if (companyRole === 'employee') return 'พนักงาน'
  return companyRole
}

type AttendanceLog = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  clock_in_distance_meters: number | null
  clock_out_distance_meters: number | null
  clock_in_accuracy_meters: number | null
  clock_out_accuracy_meters: number | null
  clock_in_device_info: { label?: string; ownerName?: string } | null
  status: string
  profiles: { full_name: string | null; email: string | null } | null
  project_sites: { name: string; projects: { name: string } | null } | null
}
type CorrectionRequest = {
  id:string
  session_id:string
  requested_clock_in_at:string|null
  requested_clock_out_at:string|null
  reason:string
  status:string
  created_at:string
  profiles:{full_name:string|null;email:string|null}|null
  attendance_sessions:{clock_in_at:string;clock_out_at:string|null;project_sites:{name:string}|null}|null
}

type ActivityLog = {
  id: string
  event_type: string
  severity: 'info' | 'warning' | 'error'
  page_path: string | null
  message: string | null
  device_label: string | null
  created_at: string
  profiles: { full_name: string | null; email: string | null } | null
}

type AppStatus = {
  profile_id: string
  device_id: string
  status: 'online' | 'away' | 'offline'
  current_path: string | null
  device_label: string | null
  last_seen_at: string
  profiles: { full_name: string | null; email: string | null } | null
}

const monthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const monthLabel = (value: string) => {
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1))
}

const formatNumberTH = (value: number) =>
  new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(value)

const buildDryRunSummaryRows = (plan: CreateEmployeeDryRunPlan) => [
  ['อีเมล', plan.input_email],
  ['ชื่อพนักงาน', plan.input_full_name],
  ['สิทธิ์ที่ตั้งในระบบ', plan.input_role],
  ['สิทธิ์ในบริษัท', plan.membership_role],
  ['บริษัท', plan.company_id],
  ['ประเภทการจ้าง', plan.employment_defaults.employment_type],
  ['สถานะเริ่มต้น', plan.employment_defaults.employment_status],
  ['ค่าแรงรายวัน', `${formatNumberTH(plan.employment_defaults.daily_rate)} บาท`],
  ['ค่าแรงเดือน', `${formatNumberTH(plan.employment_defaults.monthly_salary)} บาท`],
  ['ค่า OT/ชม.', `${formatNumberTH(plan.employment_defaults.overtime_hourly_rate)} บาท`],
  ['โหมด', plan.will_write ? 'เขียนลง DB' : 'จำลอง (ไม่เขียน DB)'],
  ['หมายเหตุ', plan.preview_note],
]

type CreateEmployeeAttemptRecord = OperationAttemptRecord<{
  full_name: string
  email: string
  role: 'employee' | 'manager'
  signature: string
}>

type NameSaveAttemptRecord = OperationAttemptRecord<{
  employee_id: string
  full_name: string
  signature: string
}>

type EmploymentSaveAttemptRecord = OperationAttemptRecord<{
  employee_id: string
  employee_code: string
  attendance_policy: string
  work_policy_id: string | null
  signature: string
}>

type EmployeeActionAttemptRecord = OperationAttemptRecord<{
  employee_id: string
  action: 'archive' | 'reactivate' | 'delete' | 'resign'
  reason: string
  last_working_on?: string
  status_effective_on?: string
  payroll_eligible_until?: string
  signature: string
  scope_summary?: string
  scope_issues?: string[]
}>

type ManageEmployeeDeletePreview = {
  attendance: number
  leave_requests: number
  overtime: number
  payrolls: number
  documents: number
  site_assignments: number
  has_other_companies: boolean
  can_delete: boolean
}

type ManageEmployeeScopeIssue = {
  field: string
  message: string
}

const createEmployeeAttemptStore = createAttemptStore<CreateEmployeeAttemptRecord['input']>('create-employee-attempts', 30)
const employeeNameAttemptStore = createAttemptStore<NameSaveAttemptRecord['input']>('employee-name-save-attempts', 30)
const employeeEmploymentAttemptStore = createAttemptStore<EmploymentSaveAttemptRecord['input']>('employee-employment-save-attempts', 30)
const employeeActionAttemptStore = createAttemptStore<EmployeeActionAttemptRecord['input']>('employee-action-attempts', 30)

export function EmployeePage() {
  usePageTitle('พนักงาน')
  const { user, profile, refreshProfile, currentCompany, signOut } = useAuth()
  const [searchParams,setSearchParams]=useSearchParams()
  const [employeeListFilter, setEmployeeListFilter]=useState<'active'|'resigned'|'all'>('active')
  const canManage = profile?.role === 'admin'
    || profile?.role === 'manager'
    || ['company_admin', 'executive', 'manager', 'site_supervisor'].includes(currentCompany?.company_role ?? '')
  const canDeleteEmployee = profile?.role === 'admin' || ['company_admin', 'executive'].includes(currentCompany?.company_role ?? '')
  const canCreate = canManage
  const [employees, setEmployees] = useState<Employee[]>([])
  const [intakeEmployeePeople, setIntakeEmployeePeople] = useState<EmployeeIntakeMaster[]>([])
  const [employeeDocumentsByProfile, setEmployeeDocumentsByProfile] = useState<Record<string, EmployeePersonDocument[]>>({})
  const [intakeDraftPerson, setIntakeDraftPerson] = useState<EmployeeIntakeMaster | null>(null)
  const [intakeDraft, setIntakeDraft] = useState<IntakeEmployeeDraft>({ full_name: '', phone: '', employment_type: 'unknown', position: '', start_date: '' })
  const [intakeDraftSaving, setIntakeDraftSaving] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [employeeDrawer, setEmployeeDrawer] = useState<Employee | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [createEmployeeErrorCode, setCreateEmployeeErrorCode] = useState<CreateEmployeeErrorCode | ''>('')
  const [createEmployeeAction, setCreateEmployeeAction] = useState('')
  const [createEmployeeRawError, setCreateEmployeeRawError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [creatingDryRun, setCreatingDryRun] = useState(false)
  const [dryRunConfirmed, setDryRunConfirmed] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<CreateEmployeeDryRunSuccess | null>(null)
  const [dryRunResultError, setDryRunResultError] = useState('')
  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'employee' as 'employee' | 'manager',
  })
  const [createEmployeePreflightIssues, setCreateEmployeePreflightIssues] = useState<OperationIssue[]>([])
  const [employmentEmployee, setEmploymentEmployee] = useState<Employee | null>(null)
  const [employmentForm, setEmploymentForm] = useState<EmploymentForm>(emptyEmployment)
  const [workPolicies, setWorkPolicies] = useState<WorkPolicyOption[]>([])
  const [employmentSaving, setEmploymentSaving] = useState(false)
  const [accountEmployee, setAccountEmployee] = useState<Employee | null>(null)
  const [accountEmail, setAccountEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)
  const [manageEmployee,setManageEmployee]=useState<Employee|null>(null)
  const [manageAction,setManageAction]=useState<'archive'|'reactivate'|'delete'|'resign'>('archive')
  const [manageReason,setManageReason]=useState('')
  const [lastWorkingOn,setLastWorkingOn]=useState(new Date().toISOString().slice(0,10))
  const [statusEffectiveOn,setStatusEffectiveOn]=useState(new Date().toISOString().slice(0,10))
  const [payrollEligibleUntil,setPayrollEligibleUntil]=useState(new Date().toISOString().slice(0,10))
  const [managePreview,setManagePreview]=useState<ManageEmployeeDeletePreview | null>(null)
  const [manageScopeIssues,setManageScopeIssues]=useState<ManageEmployeeScopeIssue[]>([])
  const [manageScopeOnly,setManageScopeOnly]=useState(false)
  const [managing,setManaging]=useState(false)
  const [manageChecking,setManageChecking]=useState(false)
  const currentMonth = monthValue(new Date())
  const previousMonthDate = new Date()
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1)
  const previousMonth = monthValue(previousMonthDate)
  const [tab, setTab] = useState(0)
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([])
  const [logMonth, setLogMonth] = useState(currentMonth)
  const [logStatus, setLogStatus] = useState('all')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [reviewingId, setReviewingId] = useState('')
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequest[]>([])
  const [reviewTarget, setReviewTarget] = useState<AttendanceLog | null>(null)
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | 'correct'>('approve')
  const [reviewReason, setReviewReason] = useState('')
  const [correctedClockOut, setCorrectedClockOut] = useState('')
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])
  const [appStatuses, setAppStatuses] = useState<AppStatus[]>([])
  const [activitySeverity, setActivitySeverity] = useState('all')
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityLoadedAt, setActivityLoadedAt] = useState(0)
  const [activitySearch, setActivitySearch] = useState('')
  const [activityPage, setActivityPage] = useState(0)
  const [activityRowsPerPage, setActivityRowsPerPage] = useState(10)
  const syncBusyRef = useRef(false)
  const lastSyncRef = useRef(0)
  const activeEmployees = useMemo(
    () => employees.filter((employee) => !isEmployeeTerminated(employee)),
    [employees],
  )
  const resignedEmployees = useMemo(
    () => employees.filter((employee) => isEmployeeTerminated(employee)),
    [employees],
  )
  const visibleEmployees = useMemo(
    () => employeeListFilter === 'all'
      ? employees
      : employeeListFilter === 'resigned'
        ? resignedEmployees
        : activeEmployees,
    [activeEmployees, employeeListFilter, employees, resignedEmployees],
  )
  const resignationMinimumAccessDate = useMemo(() => {
    if (!lastWorkingOn) return ''
    const nextDay = new Date(`${lastWorkingOn}T00:00:00`)
    nextDay.setDate(nextDay.getDate() + 1)
    return nextDay.toISOString().slice(0, 10)
  }, [lastWorkingOn])
  const manageFormIssues = useMemo(() => {
    const issues: string[] = []
    if (manageScopeOnly) return issues
    if (manageAction !== 'delete' && !manageReason.trim()) {
      issues.push('กรุณาระบุเหตุผลก่อนยืนยัน')
    }
    if (manageAction === 'resign') {
      if (!lastWorkingOn) issues.push('กรุณาระบุวันสุดท้ายทำงาน')
      if (!statusEffectiveOn) issues.push('กรุณาระบุวันที่ตัดสิทธิ์ / เข้าใช้งานไม่ได้')
      if (!payrollEligibleUntil) issues.push('กรุณาระบุวันคิดเงินถึงวันที่')
      if (lastWorkingOn && statusEffectiveOn && statusEffectiveOn <= lastWorkingOn) {
        issues.push(`วันที่ตัดสิทธิ์ต้องเป็น ${resignationMinimumAccessDate} หรือหลังจากนั้น`)
      }
      if (lastWorkingOn && payrollEligibleUntil && payrollEligibleUntil > lastWorkingOn) {
        issues.push('วันคิดเงินถึงต้องไม่เกินวันสุดท้ายทำงาน')
      }
    }
    if (manageAction === 'delete' && managePreview?.can_delete === false) {
      issues.push('ข้อมูลนี้ยังมีประวัติผูกอยู่ จึงลบถาวรไม่ได้')
    }
    if (manageScopeIssues.length > 0) {
      issues.push(...manageScopeIssues.map((issue) => issue.message))
    }
    return issues
  }, [lastWorkingOn, manageAction, managePreview?.can_delete, manageReason, manageScopeIssues, manageScopeOnly, payrollEligibleUntil, resignationMinimumAccessDate, statusEffectiveOn])

  const createEmployeePreflightResult = () => {
    const payload = validateCreateEmployeePayload({
      fullName: newEmployee.fullName,
      email: newEmployee.email,
      password: newEmployee.password,
      role: newEmployee.role,
      companyId: currentCompany?.company_id ?? null,
    })
    const signature = createSignature({
      full_name: newEmployee.fullName.trim(),
      email: newEmployee.email.trim().toLowerCase(),
      role: newEmployee.role,
    })
    return {
      ...toPreflightResult({
        canProceed: payload.canProceed,
        issues: payload.issues,
        signature,
      }),
      issues: payload.issues,
      signature,
    }
  }

  const setCreateEmployeeAttempt = (entry: CreateEmployeeAttemptRecord) => {
    createEmployeeAttemptStore.upsert(entry)
    void globalMutationAttemptStore.upsert(entry)
  }
  const setEmployeeNameAttempt = (entry: NameSaveAttemptRecord) => {
    employeeNameAttemptStore.upsert(entry)
    void globalMutationAttemptStore.upsert(entry)
  }
  const setEmployeeEmploymentAttempt = (entry: EmploymentSaveAttemptRecord) => {
    employeeEmploymentAttemptStore.upsert(entry)
    void globalMutationAttemptStore.upsert(entry)
  }
  const setEmployeeActionAttempt = (entry: EmployeeActionAttemptRecord) => {
    employeeActionAttemptStore.upsert(entry)
    void globalMutationAttemptStore.upsert(entry)
  }

  const loadEmployees = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const query = supabase
      .from('profiles')
      .select('id,full_name,email,role')
      .order('full_name', { ascending: true, nullsFirst: false })
    if (!canManage) query.eq('id', user.id)
    const membershipQuery = !currentCompany?.company_id
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .from('company_members')
        .select('profile_id,company_role,active')
        .eq('company_id', currentCompany.company_id)

    const intakePeopleQuery = !currentCompany?.company_id
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('employee_people').select('id,source_intake_id,employee_code,full_name,phone,employment_type,position,start_date,employee_status,created_at').eq('company_id', currentCompany.company_id).eq('employee_status','preboarding').order('created_at', { ascending: false }).limit(500)
    const intakePersonDocumentsQuery = !currentCompany?.company_id
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('employee_person_documents').select('id,employee_person_id,document_type,link_status').eq('company_id', currentCompany.company_id).order('created_at')
    const employeePersonProfilesQuery = !currentCompany?.company_id
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('employee_people').select('id,profile_id').eq('company_id', currentCompany.company_id).not('profile_id', 'is', null).limit(1000)
    const employeeIntakesQuery = !currentCompany?.company_id
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('employee_intakes').select('id,status,missing_fields').eq('company_id', currentCompany.company_id).limit(500)
    const [profileResult,employmentResult,assignmentResult,readinessResult,membershipResult,intakePeopleResult,intakePersonDocumentsResult,employeeIntakesResult,employeePersonProfilesResult]=await Promise.all([
      query,
      supabase.from('employee_employment_records').select('profile_id,employee_code,employment_type,job_title,department,employment_status,attendance_policy,work_policy_id').eq('company_id',currentCompany?.company_id ?? ''),
      supabase.from('employee_site_assignments').select('profile_id').eq('company_id',currentCompany?.company_id ?? '').eq('active',true),
      supabase.from('employee_onboarding_readiness').select('profile_id,has_work_policy,ready_to_clock').eq('company_id',currentCompany?.company_id ?? ''),
      membershipQuery,
      intakePeopleQuery,
      intakePersonDocumentsQuery,
      employeeIntakesQuery,
      employeePersonProfilesQuery,
    ])
    if (profileResult.error||employmentResult.error||assignmentResult.error||readinessResult.error||membershipResult.error||intakePeopleResult.error||intakePersonDocumentsResult.error||employeeIntakesResult.error||employeePersonProfilesResult.error) {
      setErrorMessage(profileResult.error
        ? userError(profileResult.error)
        : employmentResult.error
          ? userError(employmentResult.error)
          : assignmentResult.error
            ? userError(assignmentResult.error)
            : readinessResult.error
              ? userError(readinessResult.error)
              : membershipResult.error
              ? userError(membershipResult.error)
              : intakePeopleResult.error
                ? userError(intakePeopleResult.error)
                : intakePersonDocumentsResult.error
                  ? userError(intakePersonDocumentsResult.error)
                : employeeIntakesResult.error
                  ? userError(employeeIntakesResult.error)
                : employeePersonProfilesResult.error
                  ? userError(employeePersonProfilesResult.error)
              : 'โหลดข้อมูลพนักงานไม่สำเร็จ')
    } else {
      const employmentMap=new Map((employmentResult.data??[]).map(row=>[row.profile_id,row]))
      const membershipMap=new Map((membershipResult.data ?? []).map((row) => [row.profile_id, { companyRole: row.company_role, active: row.active }]))
      const readinessMap=new Map((readinessResult.data??[]).map(row=>[row.profile_id,row]))
      const siteCounts=new Map<string,number>();for(const row of assignmentResult.data??[])siteCounts.set(row.profile_id,(siteCounts.get(row.profile_id)??0)+1)
      const deriveRole = (row: { role: 'admin' | 'manager' | 'employee' }, companyRole: string | undefined) => {
        if (row.role === 'admin') return 'admin'
        if (companyRole === 'company_admin') return 'admin'
        if (companyRole === 'executive' || companyRole === 'manager') return 'manager'
        return row.role
      }
      const rows = (profileResult.data ?? []).map((row) => ({
        ...row,
        ...employmentMap.get(row.id),
        ...readinessMap.get(row.id),
        company_role: membershipMap.get(row.id)?.companyRole,
        membership_active: membershipMap.get(row.id)?.active,
        role: deriveRole(row, membershipMap.get(row.id)?.companyRole),
        site_count: siteCounts.get(row.id) ?? 0,
      })) as Employee[]
      setEmployees(rows)
      setNames(Object.fromEntries(rows.map((employee) => [employee.id, employee.full_name ?? ''])))
      const documentsByPerson = new Map<string, EmployeeIntakeMaster['documents']>()
      for (const document of intakePersonDocumentsResult.data ?? []) {
        const current = documentsByPerson.get(document.employee_person_id) ?? []
        current.push(document)
        documentsByPerson.set(document.employee_person_id, current)
      }
      const profileByPerson = new Map((employeePersonProfilesResult.data ?? []).map((person) => [person.id, person.profile_id]))
      const documentsByProfile = new Map<string, EmployeePersonDocument[]>()
      for (const document of intakePersonDocumentsResult.data ?? []) {
        const profileId = profileByPerson.get(document.employee_person_id)
        if (!profileId) continue
        const current = documentsByProfile.get(profileId) ?? []
        current.push(document)
        documentsByProfile.set(profileId, current)
      }
      setEmployeeDocumentsByProfile(Object.fromEntries(documentsByProfile))
      const intakeById = new Map((employeeIntakesResult.data ?? []).map((intake) => [intake.id, intake]))
      setIntakeEmployeePeople((intakePeopleResult.data ?? []).map((person) => ({
        ...person,
        intake_status: person.source_intake_id ? intakeById.get(person.source_intake_id)?.status ?? null : null,
        missing_fields: person.source_intake_id ? intakeById.get(person.source_intake_id)?.missing_fields ?? [] : [],
        documents: documentsByPerson.get(person.id) ?? [],
      })))
    }
    setLoading(false)
  }, [canManage, currentCompany, user])

  const refreshWithProfile = useCallback(async () => {
    if (syncBusyRef.current) return
    const now = Date.now()
    if (now - lastSyncRef.current < 1200) return
    syncBusyRef.current = true
    lastSyncRef.current = now
    try {
      await refreshProfile()
      await loadEmployees()
    } finally {
      syncBusyRef.current = false
    }
  }, [refreshProfile, loadEmployees])

  const openIntakeDraft = (person: EmployeeIntakeMaster) => {
    setIntakeDraftPerson(person)
    setIntakeDraft({ full_name: person.full_name ?? '', phone: person.phone ?? '', employment_type: person.employment_type ?? 'unknown', position: person.position ?? '', start_date: person.start_date ?? '' })
    setErrorMessage('')
  }

  const saveIntakeDraft = async (approveAfterSave = false) => {
    if (!intakeDraftPerson?.source_intake_id) { setErrorMessage('รายการนี้ไม่มี Intake อ้างอิง จึงยังอัปเดตผ่านกระบวนการกลางไม่ได้'); return }
    if (!intakeDraft.full_name.trim()) { setErrorMessage('กรุณาระบุชื่อพนักงาน'); return }
    setIntakeDraftSaving(true); setErrorMessage('')
    try {
      const result = await documentFlowGateway.reviewEmployeeIntake({ intakeId: intakeDraftPerson.source_intake_id, action: 'update_preboarding', draft: { ...intakeDraft, full_name: intakeDraft.full_name.trim(), phone: intakeDraft.phone.trim(), position: intakeDraft.position.trim() } })
      if (result.error || result.data?.ok === false) { const parsed = await parseFunctionError(result.error ?? result.data); throw parsed.payload ?? result.error ?? new Error('บันทึกข้อมูลก่อนเริ่มงานไม่สำเร็จ') }
      const remaining = Array.isArray(result.data?.remaining_fields) ? result.data.remaining_fields : []
      const labels: Record<string,string> = { phone: 'เบอร์โทร', employment_type: 'ประเภทการจ้าง', position: 'ตำแหน่ง', start_date: 'วันที่เริ่มงาน' }
      if (approveAfterSave) {
        if (remaining.length > 0) throw new Error(`ข้อมูลยังไม่ครบ: ${remaining.map((field: string) => labels[field] ?? field).join(', ')}`)
        const approval = await documentFlowGateway.reviewEmployeeIntake({ intakeId: intakeDraftPerson.source_intake_id, action: 'approve' })
        if (approval.error || approval.data?.ok === false) { const parsed = await parseFunctionError(approval.error ?? approval.data); throw parsed.payload ?? approval.error ?? new Error('อนุมัติส่งเข้า Onboarding ไม่สำเร็จ') }
        setMessage('บันทึกและยืนยันข้อมูลครบแล้ว · ส่งเข้าสู่ Onboarding สำเร็จ โดยยังไม่เปิด Login ลงเวลา หรือค่าแรง')
      } else {
        setMessage(remaining.length === 0 ? 'บันทึกแล้ว · ข้อมูลครบ พร้อมให้ Admin ยืนยันขั้นสุดท้าย' : `บันทึกร่างแล้ว · ยังขาด ${remaining.map((field: string) => labels[field] ?? field).join(', ')}`)
      }
      setIntakeDraftPerson(null); await loadEmployees()
    } catch (error) {
      const friendly = toFriendlyError({ error, module: 'employee_preboarding', fallback: 'บันทึกข้อมูลก่อนเริ่มงานไม่สำเร็จ' })
      setErrorMessage(`${friendly.message} · แนวทาง: ${friendly.action}`)
    } finally { setIntakeDraftSaving(false) }
  }

  const navigate = useNavigate()
  const copyText = async (text: string, fallbackMessage: string) => {
    if (typeof navigator === 'undefined') return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        setMessage(fallbackMessage)
        return
      }
    } catch {
      // keep trying fallback
    }

    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    setMessage(fallbackMessage)
  }

  const copyManageScopeSummary = () => {
    const employeeName = manageEmployee ? (manageEmployee.full_name || manageEmployee.email || 'unknown') : 'unknown'
    const payload = {
      module: 'manage-employee',
      profile_id: manageEmployee?.id,
      employee_name: employeeName,
      action: manageAction,
      scope_summary: manageScopeSummaryText,
      issues: manageScopeIssues.map((issue) => issue.message),
      reason: manageReason,
    }
    void copyText(JSON.stringify(payload, null, 2), 'คัดลอกปัญหาการจัดการสำเร็จ')
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshWithProfile()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshWithProfile])

  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshWithProfile()
      }
    }
    window.addEventListener('focus', refreshOnFocus)
    window.addEventListener('visibilitychange', refreshOnFocus)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      window.removeEventListener('visibilitychange', refreshOnFocus)
    }
  }, [refreshWithProfile])

  const saveName = async (employee: Employee) => {
    setSavingId(employee.id)
    setMessage('')
    setErrorMessage('')
    const nextName = (names[employee.id] ?? '').trim()
    if (nextName.length < 2) {
      setSavingId('')
      setErrorMessage('ชื่อพนักงานต้องมีอย่างน้อย 2 ตัวอักษร')
      return
    }
    const attemptId = generateAttemptId()
    const attemptRecord: NameSaveAttemptRecord = {
      id: attemptId,
      module: 'employee-name-save',
      action: 'save',
      status: 'pending',
      actor_profile_id: user?.id ?? '',
      company_id: currentCompany?.company_id ?? null,
      input: {
        employee_id: employee.id,
        full_name: nextName,
        signature: createSignature({ employee_id: employee.id, full_name: nextName }),
      },
      created_at: new Date().toISOString(),
    }
    setEmployeeNameAttempt(attemptRecord)

    const { error } = await supabase.rpc('set_profile_full_name', {
      target_profile_id: employee.id,
      new_full_name: nextName,
    })
    if (error) {
      const verified = await (async () => {
        try {
          const verify = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', employee.id)
            .maybeSingle()
          if (verify.error || !verify.data) return false
          return verify.data.full_name === nextName
        } catch {
          return false
        }
      })()

      setEmployeeNameAttempt({
        ...attemptRecord,
        status: verified ? 'success' : 'error',
        error_code: verified ? undefined : userError(error),
        error: verified ? undefined : userError(error),
      })
      setErrorMessage(verified ? `แม้แจ้งเตือนบางอย่าง แต่ระบบพบว่าชื่ออัปเดตแล้ว` : userError(error))
    } else {
      setEmployeeNameAttempt({ ...attemptRecord, status: 'success' })
      setMessage(`บันทึกชื่อ ${nextName} แล้ว ข้อความ LINE ครั้งถัดไปจะแสดงชื่อนี้`)
      await loadEmployees()
      if (employee.id === user?.id) await refreshProfile()
    }
    setSavingId('')
  }

  const verifyEmployeeCreatedInDb = async () => {
    if (!currentCompany?.company_id || !newEmployee.email.trim()) return false
    const email = newEmployee.email.trim().toLowerCase()

    const profileResult = await supabase
      .from('profiles')
      .select('id, full_name, email, created_at')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (profileResult.error || !profileResult.data?.id) return false
    const profileId = profileResult.data.id

    const membershipResult = await supabase
      .from('company_members')
      .select('company_id')
      .eq('company_id', currentCompany.company_id)
      .eq('profile_id', profileId)
      .eq('active', true)
      .maybeSingle()

    if (membershipResult.error || !membershipResult.data) return false

    const employmentResult = await supabase
      .from('employee_employment_records')
      .select('profile_id')
      .eq('company_id', currentCompany.company_id)
      .eq('profile_id', profileId)
      .maybeSingle()

    if (employmentResult.error || !employmentResult.data) return false

    return true
  }

  const createEmployee = async () => {
    setCreating(true)
    setMessage('')
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    setCreateEmployeeRawError('')
    setDryRunResult(null)
    setDryRunResultError('')
    const preflight = createEmployeePreflightResult()
    setCreateEmployeePreflightIssues(preflight.issues)
    if (!preflight.canProceed) {
      setCreating(false)
      setCreateEmployeeErrorCode('UNHANDLED')
      setCreateEmployeeAction('กรุณาแก้ปัญหาตามรายการตรวจสอบก่อนบันทึก')
      setCreateEmployeeRawError(preflight.blockingIssues.length
        ? `พบข้อมูลไม่ครบ: ${summarizeCreateEmployeeIssues(preflight.blockingIssues)}`
        : `ข้อมูลเตรียมส่งไม่ครบ: ${summarizePreflight(preflight.issues)}`)
      return
    }

    const attemptId = generateAttemptId()
    const attemptRecord: CreateEmployeeAttemptRecord = {
      id: attemptId,
      module: 'create-employee',
      action: 'create',
      status: 'pending',
      actor_profile_id: user?.id ?? '',
      company_id: currentCompany?.company_id ?? null,
      input: {
        full_name: newEmployee.fullName.trim(),
        email: newEmployee.email.trim().toLowerCase(),
        role: newEmployee.role,
        signature: preflight.signature,
      },
      created_at: new Date().toISOString(),
    }
    setCreateEmployeeAttempt(attemptRecord)
    try {
      const result = await invokeHrMutation<CreateEmployeeSuccess | CreateEmployeeError>('create-employee', newEmployee)
      console.log('[create-employee] result', result)
      if (result.error || ('error' in (result.data ?? {}))) {
        const serverDataError = result.data && 'error' in result.data
          ? toStandardErrorPayload(result.data)
          : null
        const parsed = await parseFunctionError(result.error ?? (result.data as unknown))
        const rawBody = parsed.raw ? `HTTP ${parsed.status ?? '400'} ${parsed.statusText ?? ''}: ${parsed.raw}`.trim() : ''
        const stagePayload: StandardErrorPayload | null = serverDataError ?? parsed.payload

        console.group('[create-employee] error diagnostics')
        console.log('hasErrorObject', !!result.error)
        console.log('responseStatus', parsed.status)
        console.log('responseStatusText', parsed.statusText)
        console.log('errorType', result.error?.name)
        console.log('errorMessage', result.error?.message)
        console.log('[create-employee] errorRawBody', parsed.raw)
        console.groupEnd()

        const friendly = toFriendlyError({
          error: stagePayload ?? result.error,
          module: 'create-employee',
          responseStatus: parsed.status,
          responseStatusText: parsed.statusText,
          fallback: 'ไม่สามารถเพิ่มพนักงานได้',
        })

        setCreateEmployeeAttempt({
          ...attemptRecord,
          status: 'error',
          request_id: result.data?.request_id ?? parsed.statusText,
          error_code: friendly.code,
          error: stagePayload?.error ?? userError(friendly),
          error_action: friendly.action,
        })

        setErrorMessage(`${userError(friendly)}\nแนวทางแก้: ${friendly.action}`)
        setCreateEmployeeAction(friendly.action)
        setCreateEmployeeErrorCode(toCreateEmployeeCode(stagePayload?.error_code ?? friendly.code))
        setCreateEmployeeRawError(rawBody || userError(friendly))

        setCreateEmployeeAction('กำลังยืนยันสถานะการเขียนจริงในระบบ...')
        const committed = await verifyEmployeeCreatedInDb()
        if (committed) {
          setMessage(`เพิ่มพนักงาน ${newEmployee.fullName} สำเร็จ กรุณาส่งอีเมลและรหัสผ่านชั่วคราวให้พนักงานด้วยช่องทางส่วนตัว`)
          setCreateOpen(false)
          setNewEmployee({ fullName: '', email: '', password: '', role: 'employee' })
          setDryRunResult(null)
          setDryRunResultError('')
          setDryRunConfirmed(false)
          setCreateEmployeeErrorCode('')
          setCreateEmployeeAction('บันทึกสำเร็จแล้ว (ยืนยันจากฐานข้อมูล)')
          setCreateEmployeeRawError('พบข้อมูลพนักงานในฐานข้อมูลหลังจากรับ error จาก API (กรุณารีโหลดรายการพนักงานเพื่อยืนยัน)')
          setCreateEmployeeAction('บันทึกสำเร็จแล้ว')
          setCreateEmployeeAttempt({
            ...attemptRecord,
            status: 'success',
            request_id: result.data?.request_id,
            error_code: undefined,
            error: undefined,
            error_action: undefined,
          })
          await loadEmployees()
          return
        }
      } else {
        setMessage(`สร้างบัญชี ${newEmployee.fullName} สำเร็จ กรุณาส่งอีเมลและรหัสผ่านชั่วคราวให้พนักงานด้วยช่องทางส่วนตัว`)
        setCreateOpen(false)
        setNewEmployee({ fullName: '', email: '', password: '', role: 'employee' })
        setCreateEmployeeAction('')
        setCreateEmployeeErrorCode('')
        setCreateEmployeeRawError('')
        setDryRunResult(null)
        setDryRunResultError('')
        setDryRunConfirmed(false)
        setCreateEmployeeAttempt({
          ...attemptRecord,
          status: 'success',
          request_id: result.data?.request_id,
        })
        await loadEmployees()
      }
    } catch (creationError) {
      const friendly = toFriendlyError({ error: creationError, module: 'create-employee', fallback: 'เกิดข้อผิดพลาดระหว่างติดต่อ API กรุณาลองใหม่อีกครั้ง' })
      const detail = creationError instanceof Error ? JSON.stringify({ name: creationError.name, message: userError(creationError) }) : String(creationError)
      setCreateEmployeeAction('กำลังยืนยันสถานะการเขียนจริงในระบบ...')
      const committed = await verifyEmployeeCreatedInDb()
      if (committed) {
        setMessage(`เพิ่มพนักงาน ${newEmployee.fullName} สำเร็จ กรุณาส่งอีเมลและรหัสผ่านชั่วคราวให้พนักงานด้วยช่องทางส่วนตัว`)
        setCreateOpen(false)
        setNewEmployee({ fullName: '', email: '', password: '', role: 'employee' })
        setDryRunResult(null)
        setDryRunResultError('')
        setDryRunConfirmed(false)
        setCreateEmployeeErrorCode('')
        setCreateEmployeeAction('บันทึกสำเร็จแล้ว (ยืนยันจากฐานข้อมูล)')
        setCreateEmployeeRawError('พบข้อมูลพนักงานในฐานข้อมูลหลังจากเกิดข้อผิดพลาดการสื่อสาร API กรุณารีโหลดรายการพนักงานเพื่อยืนยัน')
        setCreateEmployeeAttempt({
          ...attemptRecord,
          status: 'success',
          error_code: undefined,
          error: undefined,
          error_action: undefined,
        })
        await loadEmployees()
        return
      }
      setCreateEmployeeAttempt({
        ...attemptRecord,
        status: 'error',
        error_code: toCreateEmployeeCode('UNHANDLED'),
        error: detail,
        error_action: friendly.action,
      })
      setCreateEmployeeRawError(detail)
      setErrorMessage(`${userError(friendly)}\nแนวทางแก้: ${friendly.action}`)
      setCreateEmployeeAction(friendly.action)
      setCreateEmployeeErrorCode('UNHANDLED')
    } finally {
      setCreating(false)
    }
  }

  const openEmployment = useCallback(async (employee: Employee) => {
    setEmploymentEmployee(employee)
    setEmploymentForm(emptyEmployment)
    const [employmentResult, policyResult] = await Promise.all([
      supabase.from('employee_employment_records')
        .select('employee_code,employment_type,job_title,department,hired_on,probation_ends_on,contract_ends_on,employment_status,attendance_policy,work_policy_id,daily_rate,monthly_salary,overtime_hourly_rate')
        .eq('company_id', currentCompany?.company_id ?? '').eq('profile_id', employee.id).maybeSingle(),
      supabase.from('work_policies').select('id,name,active').eq('active', true).order('name'),
    ])
    setWorkPolicies((policyResult.data ?? []) as WorkPolicyOption[])
    const error = employmentResult.error || policyResult.error
    const employmentData = employmentResult.data
    if (error) setErrorMessage(userError(error))
    else if (employmentData) setEmploymentForm(Object.fromEntries(
      Object.entries(emptyEmployment).map(([key]) => [key, employmentData[key as keyof typeof employmentData] ?? '']),
    ) as EmploymentForm)
  },[currentCompany?.company_id])

  const reloginForCreatePermission = async () => {
    setErrorMessage('กำลังออกจากระบบเพื่อต่ออายุสิทธิ์...')
    try {
      await signOut()
      window.location.href = '/login'
    } catch (reloginError) {
      setErrorMessage(reloginError instanceof Error ? userError(reloginError) : 'ไม่สามารถออกจากระบบเพื่อเข้าสู่ระบบใหม่ได้')
    }
  }

  const clearCreateForm = () => {
    setNewEmployee({
      fullName: '',
      email: '',
      password: '',
      role: newEmployee.role,
    })
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    setCreateEmployeeRawError('')
    setCreatingDryRun(false)
    setDryRunResult(null)
    setDryRunResultError('')
    setDryRunConfirmed(false)
    setCreateEmployeePreflightIssues([])
  }

  const clearCreateDiagnostics = () => {
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    setCreateEmployeeRawError('')
    setDryRunResultError('')
    setDryRunResult(null)
    setDryRunConfirmed(false)
    setCreateEmployeePreflightIssues([])
  }

  const clearCreateEmployeeField = (field: 'fullName' | 'email' | 'password') => {
    setNewEmployee((current) => ({ ...current, [field]: '' }))
    clearCreateDiagnostics()
  }

  const runCreateEmployeeDryRun = async () => {
    setCreatingDryRun(true)
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    setCreateEmployeeRawError('')
    setErrorMessage('')
    setMessage('')
    setDryRunResult(null)
    setDryRunResultError('')
    setDryRunConfirmed(false)
    const preflight = createEmployeePreflightResult()
    setCreateEmployeePreflightIssues(preflight.issues)
    if (!preflight.canProceed) {
      setCreatingDryRun(false)
      setCreateEmployeeErrorCode('UNHANDLED')
      setCreateEmployeeAction('กรุณาแก้ปัญหาตามรายการตรวจสอบก่อนรันทดสอบ dry-run')
      setCreateEmployeeRawError(preflight.blockingIssues.length
        ? `ไม่สามารถรัน dry-run ได้: ${summarizeCreateEmployeeIssues(preflight.blockingIssues)}`
        : `ข้อมูลเตรียมทดสอบไม่ครบ: ${summarizePreflight(preflight.issues)}`)
      return
    }
    try {
      const result = await invokeHrMutation<CreateEmployeeDryRunSuccess | CreateEmployeeSuccess>('create-employee', { ...newEmployee, dryRun: true })
      if (result.error || ('error' in (result.data ?? {}))) {
        const serverDataError = result.data && 'error' in result.data
          ? toStandardErrorPayload(result.data)
          : null
        const parsed = await parseFunctionError(result.error ?? (result.data as unknown))
        const rawBody = parsed.raw ? `HTTP ${parsed.status ?? '400'} ${parsed.statusText ?? ''}: ${parsed.raw}`.trim() : ''
        const stagePayload: StandardErrorPayload | null = serverDataError ?? parsed.payload
        const friendly = toFriendlyError({
          error: stagePayload ?? result.error,
          module: 'create-employee',
          responseStatus: parsed.status,
          responseStatusText: parsed.statusText,
          fallback: 'ไม่สามารถรันแบบทดสอบการเพิ่มพนักงานได้',
        })
        setDryRunResultError(`${userError(friendly)}${friendly.action ? `\nแนวทางแก้: ${friendly.action}` : ''}`)
        if (rawBody) {
          setCreateEmployeeRawError(rawBody)
        }
      } else {
        const payload = result.data
        if (payload && 'ok' in payload && payload.ok && payload.dry_run) {
          if (!payload.plan) {
            setDryRunResultError(`ผลลัพธ์ dry-run จากระบบไม่ครบ: ไม่พบแผนการทำงาน (plan)\nRequest ID: ${payload.request_id ?? 'ไม่ระบุ'}\nโปรดลองอีกครั้ง หรือติดต่อทีมเทคนิคพร้อมแนบ Request ID`)
          } else {
          setDryRunResult(payload)
          setDryRunConfirmed(false)
          setMessage('Dry-run ผ่าน: ข้อมูลผ่าน validation และสามารถเพิ่มพนักงานได้')
          }
        } else {
          setDryRunResultError(`ผลลัพธ์ไม่ตรงตามที่คาด: dryRun ควรได้ { ok: true, dry_run: true, plan: ... } แต่ได้ ${payload ? JSON.stringify({ ok: payload.ok, dry_run: payload.dry_run, hasPlan: !!(payload as CreateEmployeeDryRunSuccess).plan, request_id: payload.request_id }) : 'ไม่มีข้อมูล'}\nRequest ID: ${(payload as CreateEmployeeDryRunSuccess).request_id ?? 'ไม่ระบุ'}\nกรุณาลองอีกครั้ง`)
        }
      }
    } catch (dryRunError) {
      const friendly = toFriendlyError({
        error: dryRunError,
        module: 'create-employee',
        fallback: 'ไม่สามารถรัน dry-run ได้ กรุณาลองอีกครั้ง',
      })
      const detail = dryRunError instanceof Error ? JSON.stringify({ name: dryRunError.name, message: userError(dryRunError) }) : String(dryRunError)
      setDryRunResultError(`${userError(friendly)}\nแนวทางแก้: ${friendly.action}`)
      setCreateEmployeeRawError(detail)
    } finally {
      setCreatingDryRun(false)
    }
  }

  const tryCreateEmployeeAgain = () => {
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    setCreateEmployeeRawError('')
    void createEmployee()
  }

  const handleCreateEmployeeRecoveryAction = () => {
    const code = createEmployeeErrorCode || undefined
    if (!code) {
      tryCreateEmployeeAgain()
      return
    }
    if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_DENIED') {
      void reloginForCreatePermission()
      return
    }
    if (code === 'EMAIL_ALREADY_EXISTS' || code === 'INVALID_EMAIL') {
      clearCreateEmployeeField('email')
      return
    }
    if (code === 'INVALID_NAME') {
      clearCreateEmployeeField('fullName')
      return
    }
    if (code === 'INVALID_PASSWORD') {
      clearCreateEmployeeField('password')
      return
    }
    tryCreateEmployeeAgain()
  }

  const requestCreateEmployee = () => {
    if (dryRunResult && !dryRunConfirmed) {
      setCreateEmployeeErrorCode('UNHANDLED')
      setCreateEmployeeAction('กดยืนยัน dry-run ก่อนสร้างจริง')
      setCreateEmployeeRawError('ต้องยืนยันผลการทดสอบ dry-run ก่อนกดสร้างจริง')
      setErrorMessage('โปรดยืนยันผล dry-run ก่อนกดบันทึกจริง')
      return
    }
    void createEmployee()
  }

  useEffect(()=>{
    const targetId=searchParams.get('employment')
    if(!targetId||loading||employmentEmployee)return
    const employee=employees.find((item)=>item.id===targetId)
    if(!employee)return
    const timer=window.setTimeout(()=>{
      void openEmployment(employee)
      setSearchParams({}, {replace:true})
    },0)
    return()=>window.clearTimeout(timer)
  },[employees,employmentEmployee,loading,openEmployment,searchParams,setSearchParams])

  const saveEmployment = async () => {
    if (!employmentEmployee || !currentCompany?.company_id) return
    if (employmentForm.attendance_policy !== 'exempt' && !employmentForm.work_policy_id) {
      setErrorMessage('กรุณาเลือกตารางเวลาทำงานก่อนบันทึกข้อมูลการจ้างงาน')
      return
    }
    if (!employmentForm.employee_code.trim()) {
      setErrorMessage('กรุณากำหนดรหัสพนักงาน')
      return
    }

    const attemptId = generateAttemptId()
    const payload = {
      company_id: currentCompany.company_id,
      profile_id: employmentEmployee.id,
      ...employmentForm,
      work_policy_id: employmentForm.attendance_policy === 'exempt' ? null : (employmentForm.work_policy_id || null),
      hired_on: employmentForm.hired_on || null,
      probation_ends_on: employmentForm.probation_ends_on || null,
      contract_ends_on: employmentForm.contract_ends_on || null,
      daily_rate: Number(employmentForm.daily_rate || 0),
      monthly_salary: Number(employmentForm.monthly_salary || 0),
      overtime_hourly_rate: Number(employmentForm.overtime_hourly_rate || 0),
      updated_at: new Date().toISOString(),
    }
    const attemptRecord: EmploymentSaveAttemptRecord = {
      id: attemptId,
      module: 'employee-employment-save',
      action: 'save',
      status: 'pending',
      actor_profile_id: user?.id ?? '',
      company_id: currentCompany.company_id,
      input: {
        employee_id: employmentEmployee.id,
        employee_code: employmentForm.employee_code.trim(),
        attendance_policy: employmentForm.attendance_policy,
        work_policy_id: employmentForm.work_policy_id || null,
        signature: createSignature({
          employee_id: employmentEmployee.id,
          employee_code: employmentForm.employee_code.trim(),
          attendance_policy: employmentForm.attendance_policy,
          work_policy_id: employmentForm.work_policy_id || null,
        }),
      },
      created_at: new Date().toISOString(),
    }
    setEmployeeEmploymentAttempt(attemptRecord)

    setEmploymentSaving(true); setErrorMessage(''); setMessage('')
    const { error } = await supabase.from('employee_employment_records').upsert(payload, { onConflict: 'company_id,profile_id' })
    if (error) {
      const verified = await (async () => {
        try {
          const verify = await supabase
            .from('employee_employment_records')
            .select('company_id,employee_code,attendance_policy,work_policy_id')
            .eq('company_id', currentCompany.company_id)
            .eq('profile_id', employmentEmployee.id)
            .eq('employee_code', employmentForm.employee_code.trim())
            .maybeSingle()
          if (verify.error || !verify.data) return false
          return (verify.data.attendance_policy ?? null) === employmentForm.attendance_policy
            && (verify.data.work_policy_id ?? null) === (employmentForm.attendance_policy === 'exempt' ? null : (employmentForm.work_policy_id || null))
        } catch {
          return false
        }
      })()
      setEmployeeEmploymentAttempt({
        ...attemptRecord,
        status: verified ? 'success' : 'error',
        error_code: verified ? undefined : userError(error),
        error: verified ? undefined : userError(error),
      })
      setErrorMessage(verified ? 'พบว่าข้อมูลการจ้างงานถูกบันทึกแล้ว แม้มี error จากคำขอ' : userError(error))
    } else {
      setEmployeeEmploymentAttempt({ ...attemptRecord, status: 'success' })
      setMessage('บันทึกข้อมูลการจ้างงานและรีเฟรชข้อมูลแล้ว')
      setEmploymentEmployee(null)
      await loadEmployees()
    }
    setEmploymentSaving(false)
  }

  const runManageAllChecks = async (employee: Employee) => {
    if (!currentCompany?.company_id) return
    setManageChecking(true)
    setErrorMessage('')

    const scopeCheck = await getManageEmployeeScopeSummary(employee.id, manageAction === 'resign')
    let preview: ManageEmployeeDeletePreview | null = null
    if (canDeleteEmployee) {
      const { data, error } = await supabase.rpc('employee_delete_preview', { target_profile_id: employee.id })
      if (error) {
        setErrorMessage(`ไม่สามารถตรวจสอบเงื่อนไขการลบถาวรได้: ${userError(error)}`)
      } else {
        preview = {
          attendance: Number(data?.attendance ?? 0),
          leave_requests: Number(data?.leave_requests ?? 0),
          overtime: Number(data?.overtime ?? 0),
          payrolls: Number(data?.payrolls ?? 0),
          documents: Number(data?.documents ?? 0),
          site_assignments: Number(data?.site_assignments ?? 0),
          has_other_companies: Boolean(data?.has_other_companies),
          can_delete: Boolean(data?.can_delete),
        }
      }
    } else {
      preview = null
    }

    setManageScopeIssues(scopeCheck.issues)
    setManagePreview(preview)
    if (scopeCheck.issues.length === 0 && !preview) {
      setMessage('ตรวจสอบสำเร็จ: สามารถดำเนินการต่อด้านความพร้อมทางสิทธิ์/การเข้าถึงได้')
    }
    setManageChecking(false)
    if (scopeCheck.issues.length > 0) {
      setErrorMessage(`ตรวจพบปัญหาที่ต้องแก้: ${scopeCheck.issues.map((issue) => issue.message).join(' · ')}`)
    }
  }

  const openAccountEditor = (employee: Employee) => {
    setEmployeeDrawer(null)
    setAccountEmployee(employee)
    setAccountEmail(employee.email ?? '')
    setAccountPassword('')
    setAccountPasswordConfirm('')
    setErrorMessage('')
    setMessage('')
  }

  const saveEmployeeAccount = async () => {
    if (!accountEmployee) return
    setErrorMessage('')
    setMessage('')
    const email = accountEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErrorMessage('รูปแบบอีเมลไม่ถูกต้อง')
    if (accountPassword.length < 10) return setErrorMessage('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร')
    if (accountPassword !== accountPasswordConfirm) return setErrorMessage('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
    setAccountSaving(true)
    const { error } = await invokeHrMutation('manage-employee-account', {
      profileId: accountEmployee.id,
      email,
      password: accountPassword,
    })
    if (error) setErrorMessage(userError(error))
    else { setMessage('แก้ไขบัญชีพนักงานเรียบร้อย'); setAccountEmployee(null); await loadEmployees() }
    setAccountSaving(false)
  }

  const openManageEmployee=async(employee:Employee)=>{
    setManageScopeOnly(false)
    setManageEmployee(employee);setManageAction('archive');setManageReason('');setManagePreview(null);setErrorMessage('')
    setManageScopeIssues([])
    await runManageAllChecks(employee)
  }

  const openResignEmployee=async(employee:Employee)=>{
    const today = new Date()
    const todayText = today.toISOString().slice(0,10)
    const nextDay = new Date(today)
    nextDay.setDate(nextDay.getDate() + 1)
    setManageScopeOnly(false)
    setManageEmployee(employee);setManageAction('resign');setManageReason('');setManagePreview(null);setErrorMessage('')
    setLastWorkingOn(todayText)
    setPayrollEligibleUntil(todayText)
    setStatusEffectiveOn(nextDay.toISOString().slice(0,10))
    setManageScopeIssues([])
    await runManageAllChecks(employee)
  }

  const openManageEmployeeScopeOnly=async(employee:Employee)=>{
    setManageScopeOnly(true)
    setManageEmployee(employee);setManageAction('archive');setManageReason('');setManagePreview(null);setErrorMessage('')
    setManageScopeIssues([])
    const scopeCheck = await getManageEmployeeScopeSummary(employee.id)
    if (!scopeCheck.canProceed) {
      setManageScopeIssues(scopeCheck.issues)
      setErrorMessage(`ตรวจพบปัญหาขอบเขตข้อมูล: ${scopeCheck.issues.map((issue) => issue.message).join(' · ')}`)
      return
    }
    setMessage('เช็ค Cross-company ครบถ้วนแล้ว: ยังไม่มีปัญหาข้อข้ามบริษัท')
  }

  const getManageEmployeeScopeSummary = async (employeeId: string, allowForeignForResignation = false): Promise<{
    canProceed: boolean
    issues: ManageEmployeeScopeIssue[]
  }> => {
    const companyId = currentCompany?.company_id ?? ''
    if (!companyId) return { canProceed: false, issues: [{ field: 'company', message: 'ยังไม่ได้เลือกบริษัทที่ทำงาน' }] }

    const [membershipResult, employmentResult, assignmentResult] = await Promise.all([
      supabase.from('company_members').select('company_id,active').eq('profile_id', employeeId),
      supabase.from('employee_employment_records').select('company_id').eq('profile_id', employeeId),
      supabase.from('employee_site_assignments').select('company_id,active').eq('profile_id', employeeId).eq('active', true),
    ])

    const issues: ManageEmployeeScopeIssue[] = []
    if (membershipResult.error || employmentResult.error || assignmentResult.error) {
      issues.push({ field: 'system', message: 'ตรวจสอบสิทธิ์/ข้อมูลสัมพันธ์ไม่ผ่าน: กรุณาลองใหม่อีกครั้ง' })
      return { canProceed: false, issues }
    }

    const membershipRows = membershipResult.data ?? []
    const thisCompanyMembership = membershipRows.find((row) => row.company_id === companyId)
    if (!thisCompanyMembership) {
      issues.push({ field: 'company_members', message: 'ไม่พบสมาชิกพนักงานในบริษัทที่เลือก' })
    }

    const foreignMembership = membershipRows.filter((row) => row.company_id !== companyId).map((row) => row.company_id)
    if (foreignMembership.length > 0 && !allowForeignForResignation) {
      issues.push({ field: 'company_members', message: `พบข้อมูลสมาชิกในบริษัทอื่น (${Array.from(new Set(foreignMembership)).join(', ')})` })
    }

    const employmentRows = employmentResult.data ?? []
    const foreignEmployment = employmentRows.filter((row) => row.company_id !== companyId).map((row) => row.company_id)
    if (foreignEmployment.length > 0 && !allowForeignForResignation) {
      issues.push({ field: 'employee_employment_records', message: `พบประวัติการจ้างในบริษัทอื่น (${Array.from(new Set(foreignEmployment)).join(', ')})` })
    }

    const assignmentRows = assignmentResult.data ?? []
    const foreignAssignments = assignmentRows.filter((row) => row.company_id !== companyId).map((row) => row.company_id)
    if (foreignAssignments.length > 0 && !allowForeignForResignation) {
      issues.push({ field: 'employee_site_assignments', message: `พบประวัติการมอบหมายไซต์ในบริษัทอื่น (${Array.from(new Set(foreignAssignments)).join(', ')})` })
    }

    return { canProceed: issues.length === 0, issues }
  }

  const submitEmployeeAction=async()=>{
    if(!manageEmployee)return
    if (manageScopeOnly) {
      setManageEmployee(null)
      setManageScopeOnly(false)
      return
    }
    setManaging(true);setErrorMessage('');setMessage('');setManageScopeIssues([])
    const attemptId = generateAttemptId()
    const attemptRecord: EmployeeActionAttemptRecord = {
      id: attemptId,
      module: 'manage-employee',
      action: manageAction,
      status: 'pending',
      actor_profile_id: user?.id ?? '',
      company_id: currentCompany?.company_id ?? null,
      input: {
        employee_id: manageEmployee.id,
        action: manageAction,
        reason: manageReason,
        last_working_on: manageAction === 'resign' ? lastWorkingOn : undefined,
        status_effective_on: manageAction === 'resign' ? statusEffectiveOn : undefined,
        payroll_eligible_until: manageAction === 'resign' ? payrollEligibleUntil : undefined,
        signature: createSignature({ employee_id: manageEmployee.id, action: manageAction, reason: manageReason, lastWorkingOn, statusEffectiveOn, payrollEligibleUntil }),
      },
      created_at: new Date().toISOString(),
    }
    setEmployeeActionAttempt(attemptRecord)

    const scopeCheck = await getManageEmployeeScopeSummary(manageEmployee.id, manageAction === 'resign')
    if (!scopeCheck.canProceed) {
      const scopeMessage = `ไม่สามารถดำเนินการได้: ${scopeCheck.issues.map((issue) => issue.message).join(' · ')}`
      setEmployeeActionAttempt({
        ...attemptRecord,
        input: {
          ...attemptRecord.input,
          scope_summary: scopeMessage,
          scope_issues: scopeCheck.issues.map((issue) => issue.message),
        },
        status: 'error',
        error_code: 'CROSS_COMPANY_SCOPE_MISMATCH',
        error: scopeMessage,
        error_action: 'ตรวจข้อมูลบริษัท/การจ้าง/มอบหมายไซต์ให้เป็นข้อมูลเดียวกันก่อนลองใหม่',
      })
      setErrorMessage(scopeMessage)
      setManaging(false)
      return
    }

    if (manageFormIssues.length > 0) {
      setErrorMessage(`กรุณาแก้ไขข้อมูลก่อนส่ง: ${manageFormIssues.join(' · ')}`)
      setManaging(false)
      return
    }

    if (manageAction === 'resign') {
      if (!lastWorkingOn || !statusEffectiveOn || !payrollEligibleUntil) {
        setErrorMessage('กรุณาระบุวันสุดท้ายทำงาน วันที่ตัดสิทธิ์ และวันคิดเงินถึงให้ครบ')
        setManaging(false)
        return
      }
      if (statusEffectiveOn <= lastWorkingOn) {
        setErrorMessage('วันที่ตัดสิทธิ์ต้องเป็นวันถัดจากวันสุดท้ายทำงานหรือหลังจากนั้น')
        setManaging(false)
        return
      }
      if (payrollEligibleUntil > lastWorkingOn) {
        setErrorMessage('วันคิดเงินถึงต้องไม่เกินวันสุดท้ายทำงาน')
        setManaging(false)
        return
      }
    }

    const {data,error}=await invokeHrMutation<ManageEmployeeResponse>('manage-employee',{profileId:manageEmployee.id,action:manageAction,reason:manageReason,lastWorkingOn,statusEffectiveOn,payrollEligibleUntil})
    let detail=data?.error||''
    if(error&&'context' in error){
      try{const body=await (error.context as Response).clone().json();detail=body?.error||detail}catch{/* use SDK message */}
    }
    const serverPayload = toStandardErrorPayload(data)
      if(error||data?.error){
      const rawErrorText = (detail || userError(error) || userError(data?.error) || 'ไม่สามารถจัดการพนักงานได้').toLowerCase()
      const errorCode = (serverPayload?.error_code || '').toLowerCase()
      const friendlyMessage = (() => {
        if (errorCode === 'cross_company_scope_mismatch'
          || rawErrorText.includes('cross-company profile reference denied')
          || rawErrorText.includes('cross-company scope')
        ) {
          return 'การจัดการนี้ขัดขวางด้วยนโยบายขอบเขตบริษัท (ข้อมูลงาน/การมอบหมายไซต์งานมีค่าบริษัทไม่ตรงกัน) กรุณาตรวจสอบความถูกต้องของข้อมูลก่อนลองใหม่'
        }
        return detail || userError(error) || userError(data?.error) || 'ไม่สามารถจัดการพนักงานได้'
      })()
      const parsedAction = manageAction === 'delete' ? 'delete' : manageAction
      const verified = await (async () => {
        try {
          const member = await supabase
            .from('company_members')
            .select('active')
            .eq('company_id', currentCompany?.company_id ?? '')
            .eq('profile_id', manageEmployee.id)
            .maybeSingle()
          if (member.error || !member.data) {
            return manageAction === 'delete'
          }
            if (parsedAction === 'archive') return member.data.active === false
            if (parsedAction === 'resign') {
              const employment = await supabase
                .from('employee_employment_records')
                .select('employment_status,resignation_status,last_working_on,status_effective_on,payroll_eligible_until')
                .eq('company_id', currentCompany?.company_id ?? '')
                .eq('profile_id', manageEmployee.id)
                .maybeSingle()
              return !employment.error
                && Boolean(employment.data)
                && ['notice','terminated'].includes(String(employment.data?.employment_status ?? ''))
                && ['pending','effective'].includes(String(employment.data?.resignation_status ?? ''))
            }
            if (parsedAction === 'reactivate') return member.data.active === true
            return true
        } catch {
          return false
        }
      })()
      setEmployeeActionAttempt({
        ...attemptRecord,
        input: {
          ...attemptRecord.input,
          scope_issues: manageScopeIssues.map((issue) => issue.message),
          scope_summary: manageScopeSummaryText,
        },
        status: verified ? 'success' : 'error',
        error_code: verified ? undefined : toCreateEmployeeCode('UNHANDLED'),
        error: verified ? undefined : friendlyMessage,
        error_action: verified ? undefined : getCreateEmployeeRecoverySuggestion('UNHANDLED'),
      })
      setErrorMessage(friendlyMessage)
      if (verified) {
        setMessage(`${manageAction === 'delete' ? 'ลบข้อมูลที่คีย์ผิดแล้ว' : manageAction === 'resign' ? 'บันทึกการลาออกแล้ว' : manageAction === 'archive' ? 'ปิดใช้งานพนักงานแล้ว' : 'เปิดใช้งานพนักงานแล้ว'}${data?.warning ? ` · ${data.warning}` : ''}`)
        setManageEmployee(null)
        await loadEmployees()
      }
    }
    else{
      setEmployeeActionAttempt({
        ...attemptRecord,
        input: {
          ...attemptRecord.input,
          scope_issues: manageScopeIssues.map((issue) => issue.message),
          scope_summary: manageScopeSummaryText,
        },
        status: 'success',
      })
      setMessage(`${manageAction==='delete'?'ลบข้อมูลที่คีย์ผิดแล้ว':manageAction==='resign'?'บันทึกการลาออกแล้ว':manageAction==='archive'?'ปิดใช้งานพนักงานแล้ว':'เปิดใช้งานพนักงานแล้ว'}${data?.warning?` · ${data.warning}`:''}`);setManageEmployee(null);await loadEmployees()
    }
      setManaging(false)
  }

  const manageScopeSummaryText = manageScopeIssues.length === 0
    ? ''
    : `ปัญหาขอบเขตข้อมูล: ${manageScopeIssues.map((issue) => issue.message).join(' · ')}`

  const buildDeleteBlockReasons = (preview: ManageEmployeeDeletePreview | null) => {
    if (!preview) return [] as string[]
    if (preview.can_delete) return ['ข้อมูลพร้อมสำหรับการลบถาวร']
    const reasons: string[] = []
    if (preview.attendance > 0) reasons.push(`มีประวัติการลงเวลา ${preview.attendance} รายการ`)
    if (preview.leave_requests > 0) reasons.push(`มีคำขอลา ${preview.leave_requests} รายการ`)
    if (preview.overtime > 0) reasons.push(`มีการบันทึก OT ${preview.overtime} รายการ`)
    if (preview.payrolls > 0) reasons.push(`มีรายการเงินเดือน/ค่าจ้าง ${preview.payrolls} รายการ`)
    if (preview.documents > 0) reasons.push(`มีเอกสารงาน ${preview.documents} รายการ`)
    if (preview.site_assignments > 0) reasons.push(`มีการมอบหมายไซต์งานยังใช้งานอยู่ ${preview.site_assignments} รายการ`)
    if (preview.has_other_companies) reasons.push('มีข้อมูลในบริษัทอื่น (ไม่สามารถลบถาวรได้ ต้องจัดการข้ามบริษัทก่อน)')
    return reasons.length ? reasons : ['ไม่สามารถลบถาวรได้ เนื่องจากมีความสัมพันธ์ข้อมูลทางธุรกรรม']
  }

  const loadAttendanceLogs = useCallback(async () => {
    if (!canManage) return
    setLoadingLogs(true)
    setErrorMessage('')
    const [year, month] = logMonth.split('-').map(Number)
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)
    let query = supabase
      .from('attendance_sessions')
      .select(`
        id,clock_in_at,clock_out_at,status,
        clock_in_distance_meters,clock_out_distance_meters,
        clock_in_accuracy_meters,clock_out_accuracy_meters,
        clock_in_device_info,
        profiles!attendance_sessions_profile_id_fkey(full_name,email),
        project_sites(name,projects(name))
      `)
      .gte('clock_in_at', start.toISOString())
      .lt('clock_in_at', end.toISOString())
      .order('clock_in_at', { ascending: false })
      .limit(200)
    if (logStatus !== 'all') query = query.eq('status', logStatus)
    else query = query.neq('status', 'duplicate')
    const [logResult, correctionResult] = await Promise.all([
      query,
      supabase.from('attendance_correction_requests').select(`
        id,session_id,requested_clock_in_at,requested_clock_out_at,reason,status,created_at,
        profiles!attendance_correction_requests_profile_id_fkey(full_name,email),
        attendance_sessions(clock_in_at,clock_out_at,project_sites(name))
      `).eq('status','pending').order('created_at',{ascending:false}).limit(100),
    ])
    if (logResult.error || correctionResult.error) setErrorMessage(logResult.error ? userError(logResult.error) : correctionResult.error ? userError(correctionResult.error) : 'โหลดข้อมูลไม่สำเร็จ')
    else {
      setAttendanceLogs((logResult.data ?? []) as unknown as AttendanceLog[])
      setCorrectionRequests((correctionResult.data ?? []) as unknown as CorrectionRequest[])
    }
    setLoadingLogs(false)
  }, [canManage, logMonth, logStatus])

  useEffect(() => {
    if (tab !== 1 || !canManage) return
    const timer = window.setTimeout(() => void loadAttendanceLogs(), 0)
    return () => window.clearTimeout(timer)
  }, [canManage, loadAttendanceLogs, tab])

  const loadAppActivity = useCallback(async () => {
    if (!canManage) return
    setLoadingActivity(true)
    setErrorMessage('')
    let logsQuery = supabase
      .from('app_activity_logs')
      .select(`
        id,event_type,severity,page_path,message,device_label,created_at,
        profiles!app_activity_logs_profile_id_fkey(full_name,email)
      `)
      .order('created_at', { ascending: false })
      .limit(100)
    if (activitySeverity !== 'all') logsQuery = logsQuery.eq('severity', activitySeverity)
    const [logsResult, statusResult] = await Promise.all([
      logsQuery,
      supabase
        .from('user_app_status')
        .select(`
          profile_id,device_id,status,current_path,device_label,last_seen_at,
          profiles!user_app_status_profile_id_fkey(full_name,email)
        `)
        .order('last_seen_at', { ascending: false }),
    ])
    const queryError = logsResult.error || statusResult.error
    if (queryError) setErrorMessage(userError(queryError))
    else {
      setActivityLogs((logsResult.data ?? []) as unknown as ActivityLog[])
      setAppStatuses((statusResult.data ?? []) as unknown as AppStatus[])
      setActivityLoadedAt(Date.now())
    }
    setLoadingActivity(false)
  }, [activitySeverity, canManage])

  useEffect(() => {
    if (tab !== 2 || !canManage) return
    const timer = window.setTimeout(() => void loadAppActivity(), 0)
    const refreshTimer = window.setInterval(() => void loadAppActivity(), 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(refreshTimer)
    }
  }, [canManage, loadAppActivity, tab])

  const reviewAttendance = async () => {
    if (!user || !reviewTarget) return
    setReviewingId(reviewTarget.id)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase.rpc('review_attendance_session', {
      target_session_id: reviewTarget.id,
      review_action: reviewAction,
      corrected_clock_out_at: reviewAction === 'correct' && correctedClockOut
        ? new Date(correctedClockOut).toISOString()
        : null,
      review_note: reviewReason.trim() || null,
    })
    if (error) setErrorMessage(userError(error))
    else {
      setMessage(reviewAction === 'reject' ? 'ไม่อนุมัติรายการลงเวลาแล้ว' : 'บันทึกผลตรวจสอบแล้ว')
      setReviewTarget(null)
      setReviewReason('')
      setCorrectedClockOut('')
      await loadAttendanceLogs()
    }
    setReviewingId('')
  }

  const openReview = (log: AttendanceLog, action: 'approve' | 'reject' | 'correct') => {
    setReviewTarget(log)
    setReviewAction(action)
    setReviewReason('')
    setCorrectedClockOut('')
  }

  const reviewCorrection = async (request:CorrectionRequest, decision:'approved'|'rejected') => {
    setReviewingId(request.id)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase.rpc('review_attendance_correction', {
      target_request_id:request.id,
      decision,
      decision_note:decision==='rejected' ? 'ไม่อนุมัติคำขอแก้ไขเวลา' : null,
    })
    if (error) setErrorMessage(userError(error))
    else {
      setMessage(decision==='approved' ? 'อนุมัติและแก้ไขเวลาแล้ว' : 'ไม่อนุมัติคำขอแก้ไขเวลาแล้ว')
      await loadAttendanceLogs()
    }
    setReviewingId('')
  }

  const filteredActivityLogs = activityLogs.filter((log) => {
    const search = activitySearch.trim().toLowerCase()
    if (!search) return true
    return [
      log.profiles?.full_name,
      log.profiles?.email,
      log.event_type,
      log.page_path,
      log.device_label,
      userError(log),
    ].some((value) => value?.toLowerCase().includes(search))
  })

  const onlineUsers = appStatuses.filter((status) =>
    activityLoadedAt - new Date(status.last_seen_at).getTime() < 120_000
    && status.status === 'online').length
  const errorCount = activityLogs.filter((log) => log.severity === 'error').length
  const activeUserCount = new Set(activityLogs.map((log) =>
    log.profiles?.email || log.profiles?.full_name).filter(Boolean)).size
  const pendingCorrectionSessionIds = new Set(correctionRequests.map((request) => request.session_id))

  const exportActivityCsv = () => {
    const headers = ['วันเวลา', 'พนักงาน', 'เหตุการณ์', 'ระดับ', 'หน้า', 'อุปกรณ์', 'รายละเอียด']
    const rows = filteredActivityLogs.map((log) => [
      new Date(log.created_at).toLocaleString('th-TH'),
      log.profiles?.full_name || log.profiles?.email || 'ไม่ทราบชื่อ',
      log.event_type,
      log.severity,
      log.page_path || '',
      log.device_label || '',
      userError(log) || '',
    ])
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = '\uFEFF' + [headers, ...rows]
      .map((row) => row.map((value) => escapeCsv(String(value))).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `wisdomai-usage-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="พนักงาน"
        description="กำหนดชื่อที่ใช้แสดงในระบบและข้อความแจ้งเตือน LINE"
        action={canCreate && tab === 0 ? (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => void refreshWithProfile()} disabled={loading}>
              รีเฟรชรายชื่อ
            </Button>
            <Button variant="outlined" onClick={() => void refreshWithProfile()} disabled={loading}>
              อัปเดตสิทธิ์และรายชื่อ
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                setCreateEmployeeAction('')
                setCreateEmployeeErrorCode('')
                setErrorMessage('')
                clearCreateForm()
                setCreateOpen(true)
              }}
            >
              เพิ่มพนักงาน
            </Button>
          </Stack>
        ) : undefined}
      />

      {message && <Alert severity="success">{message}</Alert>}
      {errorMessage && <Alert severity="error" sx={{ whiteSpace: 'pre-line' }}>{errorMessage}</Alert>}

      {canManage && (
        <Paper variant="outlined">
          <Tabs value={tab} onChange={(_event, nextTab: number) => setTab(nextTab)} variant="fullWidth">
            <Tab label="รายชื่อพนักงาน" />
            <Tab label="รายงานลงเวลา" />
            <Tab label="การใช้งานระบบ" />
          </Tabs>
        </Paper>
      )}

      {tab === 0 && (loading ? (
        <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress /></Stack>
      ) : (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'stretch', md: 'center' } }}
            >
              <TextField
                select
                value={employeeListFilter}
                onChange={(event) => setEmployeeListFilter(event.target.value as 'active'|'resigned'|'all')}
                size="small"
                label="แสดงรายชื่อ"
                sx={{ minWidth: 220 }}
              >
                <MenuItem value="active">พนักงานปกติ ({activeEmployees.length})</MenuItem>
                <MenuItem value="resigned">พนักงานลาออก ({resignedEmployees.length})</MenuItem>
                <MenuItem value="all">รวมพนักงานทั้งหมด ({employees.length})</MenuItem>
              </TextField>
              <Chip size="small" label={`ลาออก: ${resignedEmployees.length}`} color="warning" variant={employeeListFilter === 'resigned' ? 'filled' : 'outlined'} />
            </Stack>
          </Paper>
          {canManage && intakeEmployeePeople.length > 0 && <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.25}>
              <Box>
                <Typography sx={{ fontWeight: 800 }}>คิว HR Onboarding จาก Intake ({intakeEmployeePeople.length})</Typography>
                <Typography variant="body2" color="text.secondary">รายการที่อนุมัติแล้วออกจาก Intake และอยู่ที่นี่เพื่อให้ HR ตั้งค่าก่อนเริ่มงาน โดยเอกสารต้นทางเชื่อมกับทะเบียนพนักงานแล้ว</Typography>
              </Box>
              <TableContainer>
                <Table size="small"><TableHead><TableRow><TableCell>พนักงาน</TableCell><TableCell>สถานะ</TableCell><TableCell>เอกสารแนบ</TableCell><TableCell align="right">จัดการ</TableCell></TableRow></TableHead><TableBody>
                  {intakeEmployeePeople.map((person) => <TableRow key={person.id}>
                    <TableCell><Typography sx={{ fontWeight: 700 }}>{person.full_name}</Typography><Typography variant="caption" color="text.secondary">{person.employee_code} · {employmentLabels[person.employment_type] ?? person.employment_type}</Typography></TableCell>
                    <TableCell><Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                      <Chip
                        size="small"
                        color={person.intake_status === 'approved' ? 'success' : person.intake_status === 'pending_review' ? 'info' : 'warning'}
                        label={person.intake_status === 'approved' ? 'ข้อมูลครบและยืนยันแล้ว' : person.intake_status === 'pending_review' ? 'ข้อมูลครบ · รอ Admin ยืนยัน' : person.missing_fields.length > 0 ? 'รอข้อมูลเพิ่ม' : 'รอตรวจข้อมูล'}
                      />
                      {person.intake_status === 'approved' && <Typography variant="caption" color="text.secondary">ขั้นตอนถัดไป: ตั้งค่าการจ้างงานและสิทธิ์</Typography>}
                    </Stack></TableCell>
                    <TableCell><Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {person.documents.length === 0 ? <Typography variant="caption" color="text.secondary">ยังไม่มีเอกสารแนบ</Typography> : person.documents.map((document) => <Chip key={document.id} size="small" color={document.link_status === 'available' ? 'success' : 'default'} label={intakeDocumentLabels[document.document_type] ?? document.document_type} />)}
                    </Stack></TableCell>
                    <TableCell align="right">{person.intake_status === 'approved'
                      ? <Chip size="small" color="success" variant="outlined" label="จบขั้นข้อมูลแล้ว" />
                      : <Button size="small" variant="outlined" onClick={() => openIntakeDraft(person)}>เพิ่ม / อัปเดตข้อมูล</Button>}
                    </TableCell>
                  </TableRow>)}
                </TableBody></Table>
              </TableContainer>
            </Stack>
          </Paper>}
          <StandardDataTable
            rows={visibleEmployees}
            getRowId={(employee) => employee.id}
            getSearchText={(employee) => `${employee.employee_code??''} ${employee.full_name ?? ''} ${employee.email ?? ''} ${employee.employment_type??''} ${employee.job_title??''} ${employee.department??''} ${employee.role} ${employmentStatusLabel(employee.employment_status)}`}
            searchLabel="ค้นหารหัส ชื่อ ประเภทจ้าง ตำแหน่ง หรือสิทธิ์"
            emptyText={employeeListFilter === 'resigned' ? 'ยังไม่มีรายชื่อพนักงานลาออก' : employeeListFilter === 'all' ? 'ยังไม่มีรายชื่อพนักงานในระบบ' : 'ยังไม่มีรายชื่อพนักงานปกติ'}
            exportFileName="wisdomai-employees"
            minWidth={760}
            columns={[
            {
              id: 'employee', label: 'พนักงาน', minWidth: 230,
              render: (employee) => <Button
                variant="text"
                onClick={() => setEmployeeDrawer(employee)}
                sx={{ display: 'block', p: 0, textAlign: 'left', textTransform: 'none' }}
              >
                <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>{employee.full_name || 'ยังไม่ระบุชื่อ'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {[employee.employee_code, employee.email].filter(Boolean).join(' · ') || 'ไม่มีข้อมูลบัญชี'}
                </Typography>
              </Button>,
              exportValue: (employee) => `${employee.employee_code || ''} ${employee.full_name || ''} ${employee.email || ''}`,
            },
            {
              id: 'employment', label: 'การจ้างงาน', minWidth: 135,
              render: employee => <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                <Chip size="small" label={employmentLabels[employee.employment_type ?? ''] ?? employee.employment_type ?? 'ยังไม่กำหนด'} />
                <Typography variant="caption" color="text.secondary">{employmentStatusLabel(employee.employment_status)}</Typography>
              </Stack>,
              exportValue: employee => `${employmentLabels[employee.employment_type ?? ''] ?? employee.employment_type ?? ''} ${employmentStatusLabel(employee.employment_status)}`,
            },
            {
              id: 'assignment', label: 'ตำแหน่ง / ไซต์', minWidth: 180,
              render: employee => <Stack spacing={0.25}>
                <Typography sx={{ fontWeight: 600 }}>{employee.job_title || 'ยังไม่ระบุตำแหน่ง'}</Typography>
                <Typography variant="caption" color="text.secondary">{employee.department || 'ไม่ระบุฝ่าย'} · {employee.site_count ?? 0} ไซต์</Typography>
              </Stack>,
              exportValue: employee => `${employee.job_title || ''} ${employee.department || ''} ${employee.site_count ?? 0}`,
            },
            {
              id: 'ready', label: 'ความพร้อม', minWidth: 130,
              render: employee => { const missing=employeeMissingData(employee); return <Button size="small" variant="text" onClick={() => setEmployeeDrawer(employee)} sx={{ p: 0, textTransform: 'none' }}><Chip size="small" color={missing.length===0 ? 'success' : 'warning'} label={missing.length===0 ? 'พร้อมทำงาน' : `ขาด: ${missing.join(', ')}`} /></Button> },
              exportValue: employee => { const missing=employeeMissingData(employee); return missing.length===0 ? 'พร้อมทำงาน' : `ขาด: ${missing.join(', ')}` },
            },
            {
              id: 'access', label: 'สิทธิ์ / สถานะ', minWidth: 125,
              render: employee => <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                <Chip size="small" label={`${employee.role}${employee.company_role ? ` (${companyRoleLabel(employee.company_role)})` : ''}`} />
                <Chip size="small" color={employmentStatusColor(employee.employment_status)} label={employmentStatusLabel(employee.employment_status)} />
                {employee.membership_active === false && (
                  <Chip size="small" color="warning" label="สมาชิกถูกปิดใช้งาน" />
                )}
              </Stack>,
              exportValue: employee => `${employee.role} ${employmentStatusLabel(employee.employment_status)}${employee.membership_active === false ? ' · สมาชิกถูกปิดใช้งาน' : ''}`,
            },
            {
              id: 'actions', label: 'จัดการ', minWidth: 105,
              render: employee => <Button size="small" variant="outlined" onClick={() => setEmployeeDrawer(employee)}>ดู / จัดการ</Button>,
            },
          ]}
          />
        </Stack>
      ))}

      {tab === 1 && canManage && (
        <Stack spacing={2}>
          {correctionRequests.length > 0 && <Paper variant="outlined" sx={{p:2}}>
            <Typography variant="h6" sx={{mb:1}}>คำขอแก้ไขเวลารอตรวจ ({correctionRequests.length})</Typography>
            <StandardDataTable
              rows={correctionRequests}
              getRowId={(request) => request.id}
              getSearchText={(request) => `${request.profiles?.full_name} ${request.profiles?.email} ${request.reason}`}
              searchLabel="ค้นหาคำขอแก้ไขเวลา"
              emptyText="ไม่มีคำขอแก้ไขเวลารอตรวจ"
              columns={[
                {id:'employee',label:'พนักงาน',minWidth:180,render:(request)=>request.profiles?.full_name||request.profiles?.email||'-'},
                {id:'original',label:'เวลาเดิม',minWidth:230,render:(request)=>
                  `${new Date(request.attendance_sessions?.clock_in_at||'').toLocaleString('th-TH')} – ${request.attendance_sessions?.clock_out_at ? new Date(request.attendance_sessions.clock_out_at).toLocaleString('th-TH') : 'ไม่มีเวลาออก'}`},
                {id:'requested',label:'เวลาที่ขอแก้',minWidth:230,render:(request)=>
                  `${request.requested_clock_in_at ? new Date(request.requested_clock_in_at).toLocaleString('th-TH') : '-'} – ${request.requested_clock_out_at ? new Date(request.requested_clock_out_at).toLocaleString('th-TH') : '-'}`},
                {id:'reason',label:'เหตุผล',minWidth:200,render:(request)=>request.reason},
                {id:'actions',label:'ดำเนินการ',minWidth:170,render:(request)=><Stack direction="row" spacing={0.5}>
                  <Button size="small" variant="contained" disabled={reviewingId===request.id}
                    onClick={()=>void reviewCorrection(request,'approved')}>อนุมัติ</Button>
                  <Button size="small" color="error" disabled={reviewingId===request.id}
                    onClick={()=>void reviewCorrection(request,'rejected')}>ปฏิเสธ</Button>
                </Stack>},
              ]}
            />
          </Paper>}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField select fullWidth label="เดือน" value={logMonth} onChange={(event) => setLogMonth(event.target.value)}>
                <MenuItem value={currentMonth}>{monthLabel(currentMonth)} (เดือนปัจจุบัน)</MenuItem>
                <MenuItem value={previousMonth}>{monthLabel(previousMonth)} (เดือนก่อน)</MenuItem>
              </TextField>
              <TextField select fullWidth label="สถานะ" value={logStatus} onChange={(event) => setLogStatus(event.target.value)}>
                <MenuItem value="all">ทุกรายการ</MenuItem>
                <MenuItem value="needs_review">รอตรวจสอบ/อยู่นอกไซต์</MenuItem>
                <MenuItem value="normal">ปกติ</MenuItem>
                <MenuItem value="approved">อนุมัติแล้ว</MenuItem>
                <MenuItem value="rejected">ไม่อนุมัติ</MenuItem>
                <MenuItem value="duplicate">รายการซ้ำ (ตรวจย้อนหลัง)</MenuItem>
              </TextField>
              <Button variant="outlined" onClick={() => void loadAttendanceLogs()}>รีเฟรช</Button>
            </Stack>
          </Paper>

          {loadingLogs ? (
            <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress /></Stack>
          ) : (
            <StandardDataTable
              rows={attendanceLogs}
              getRowId={(log) => log.id}
              getSearchText={(log) => [
                log.profiles?.full_name,
                log.profiles?.email,
                log.project_sites?.projects?.name,
                log.project_sites?.name,
                log.status,
                log.clock_in_device_info?.ownerName,
                log.clock_in_device_info?.label,
              ].filter(Boolean).join(' ')}
              searchLabel="ค้นหาพนักงาน โครงการ ไซต์ อุปกรณ์ หรือสถานะ"
              emptyText="ไม่พบรายการลงเวลาตามตัวกรองที่เลือก"
              exportFileName="wisdomai-employee-attendance"
              minWidth={1450}
              columns={[
                {
                  id: 'employee',
                  label: 'พนักงาน',
                  minWidth: 180,
                  render: (log) => log.profiles?.full_name || log.profiles?.email || 'ไม่ทราบชื่อ',
                  exportValue: (log) => log.profiles?.full_name || log.profiles?.email,
                },
                {
                  id: 'project',
                  label: 'โครงการ/ไซต์',
                  minWidth: 200,
                  render: (log) => `${log.project_sites?.projects?.name ?? '-'} · ${log.project_sites?.name ?? '-'}`,
                  exportValue: (log) => `${log.project_sites?.projects?.name ?? ''} · ${log.project_sites?.name ?? ''}`,
                },
                {
                  id: 'clock-in',
                  label: 'เวลาเข้า',
                  minWidth: 180,
                  render: (log) => new Date(log.clock_in_at).toLocaleString('th-TH'),
                  exportValue: (log) => new Date(log.clock_in_at).toLocaleString('th-TH'),
                },
                {
                  id: 'clock-out',
                  label: 'เวลาออก',
                  minWidth: 180,
                  render: (log) => log.clock_out_at ? new Date(log.clock_out_at).toLocaleString('th-TH') : 'ยังไม่ได้ลงเวลาออก',
                  exportValue: (log) => log.clock_out_at ? new Date(log.clock_out_at).toLocaleString('th-TH') : '',
                },
                {
                  id: 'distance',
                  label: 'ระยะจากไซต์ เข้า/ออก',
                  minWidth: 170,
                  render: (log) => `${log.clock_in_distance_meters === null ? '-' : `${Math.round(log.clock_in_distance_meters)} ม.`} / ${log.clock_out_distance_meters === null ? '-' : `${Math.round(log.clock_out_distance_meters)} ม.`}`,
                  exportValue: (log) => `${log.clock_in_distance_meters ?? ''}/${log.clock_out_distance_meters ?? ''}`,
                },
                {
                  id: 'accuracy',
                  label: 'ความแม่นยำ GPS เข้า/ออก',
                  minWidth: 190,
                  render: (log) => `±${log.clock_in_accuracy_meters === null ? '-' : `${Math.round(log.clock_in_accuracy_meters)} ม.`} / ±${log.clock_out_accuracy_meters === null ? '-' : `${Math.round(log.clock_out_accuracy_meters)} ม.`}`,
                  exportValue: (log) => `${log.clock_in_accuracy_meters ?? ''}/${log.clock_out_accuracy_meters ?? ''}`,
                },
                {
                  id: 'device',
                  label: 'เจ้าของมือถือ/อุปกรณ์',
                  minWidth: 220,
                  render: (log) => `${log.clock_in_device_info?.ownerName || 'ยังไม่ระบุ'} · ${log.clock_in_device_info?.label || 'ไม่ทราบอุปกรณ์'}`,
                  exportValue: (log) => `${log.clock_in_device_info?.ownerName || ''} · ${log.clock_in_device_info?.label || ''}`,
                },
                {
                  id: 'status',
                  label: 'สถานะ',
                  minWidth: 150,
                  render: (log) => {
                    const isReview = log.status === 'needs_review' || log.status === 'pending'
                    return <Chip
                      size="small"
                      label={log.status === 'needs_review' ? 'รอตรวจสอบ/อยู่นอกไซต์' : log.status === 'duplicate' ? 'รายการซ้ำ' : log.status}
                      color={isReview ? 'warning' : log.status === 'approved' || log.status === 'normal' ? 'success' : log.status === 'rejected' || log.status === 'duplicate' ? 'error' : 'default'}
                    />
                  },
                  exportValue: (log) => log.status === 'needs_review' ? 'รอตรวจสอบ/อยู่นอกไซต์' : log.status === 'duplicate' ? 'รายการซ้ำ' : log.status,
                },
                {
                  id: 'actions',
                  label: 'ดำเนินการ',
                  minWidth: 170,
                  render: (log) => pendingCorrectionSessionIds.has(log.id)
                    ? <Chip size="small" color="warning" label="ตรวจจากคำขอแก้เวลา" />
                    : log.status === 'needs_review' || log.status === 'pending' ? (
                    <Stack direction="row" spacing={0.5}>
                      {log.clock_out_at && <Button size="small" variant="contained" color="success" disabled={reviewingId === log.id} onClick={() => openReview(log, 'approve')}>อนุมัติ</Button>}
                      {!log.clock_out_at && <Button size="small" variant="outlined" onClick={() => openReview(log, 'correct')}>เพิ่มเวลาออก</Button>}
                      <Button size="small" variant="outlined" color="error" disabled={reviewingId === log.id} onClick={() => openReview(log, 'reject')}>ไม่อนุมัติ</Button>
                    </Stack>
                  ) : '-',
                },
              ]}
            />
          )}
        </Stack>
      )}

      {tab === 2 && canManage && (
        <Stack spacing={2}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ '& > *': { flex: 1 } }}
          >
            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Typography variant="body2" color="text.secondary">ออนไลน์ขณะนี้</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'success.main' }}>{onlineUsers}</Typography>
              <Typography variant="caption" color="text.secondary">อัปเดตสถานะทุก 1 นาที</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Typography variant="body2" color="text.secondary">ผู้ใช้งานในรายการล่าสุด</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{activeUserCount}</Typography>
              <Typography variant="caption" color="text.secondary">จาก Log สูงสุด 100 รายการ</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Typography variant="body2" color="text.secondary">ข้อผิดพลาดล่าสุด</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: errorCount > 0 ? 'error.main' : 'success.main' }}>
                {errorCount}
              </Typography>
              <Typography variant="caption" color="text.secondary">ใช้ติดตามปัญหาหน้าเว็บ</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2.25 }}>
              <Typography variant="body2" color="text.secondary">เหตุการณ์ที่บันทึก</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{activityLogs.length}</Typography>
              <Typography variant="caption" color="text.secondary">แสดงสูงสุด 100 รายการล่าสุด</Typography>
            </Paper>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                fullWidth
                label="ค้นหาพนักงาน หน้า อุปกรณ์ หรือข้อความ"
                value={activitySearch}
                onChange={(event) => {
                  setActivitySearch(event.target.value)
                  setActivityPage(0)
                }}
              />
              <TextField
                select
                fullWidth
                label="ระดับเหตุการณ์"
                value={activitySeverity}
                onChange={(event) => setActivitySeverity(event.target.value)}
              >
                <MenuItem value="all">ทั้งหมด</MenuItem>
                <MenuItem value="error">ข้อผิดพลาด</MenuItem>
                <MenuItem value="warning">คำเตือน</MenuItem>
                <MenuItem value="info">ข้อมูลทั่วไป</MenuItem>
              </TextField>
              <Button variant="outlined" onClick={() => void loadAppActivity()}>รีเฟรช</Button>
              <Button
                variant="contained"
                disabled={filteredActivityLogs.length === 0}
                onClick={exportActivityCsv}
              >
                Export CSV
              </Button>
            </Stack>
          </Paper>

          <Typography variant="h6">สถานะผู้ใช้งานล่าสุด</Typography>
          {appStatuses.length === 0 ? (
            <Alert severity="info">ยังไม่มีข้อมูลสถานะผู้ใช้งาน</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>พนักงาน</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>สถานะ</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>หน้าปัจจุบัน</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>อุปกรณ์</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>ติดต่อระบบล่าสุด</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {appStatuses.map((status) => {
                    const recent = activityLoadedAt - new Date(status.last_seen_at).getTime() < 120_000
                    const effectiveStatus = recent ? status.status : 'offline'
                    const name = status.profiles?.full_name || status.profiles?.email || 'ไม่ทราบชื่อ'
                    return (
                      <TableRow key={`${status.profile_id}-${status.device_id}`} hover>
                        <TableCell sx={{ fontWeight: 700 }}>{name}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={effectiveStatus === 'online' ? 'ออนไลน์' : effectiveStatus === 'away' ? 'ไม่ได้ใช้งาน' : 'ออฟไลน์'}
                            color={effectiveStatus === 'online' ? 'success' : effectiveStatus === 'away' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{status.current_path || '-'}</TableCell>
                        <TableCell>{status.device_label || 'ไม่ทราบอุปกรณ์'}</TableCell>
                        <TableCell>{new Date(status.last_seen_at).toLocaleString('th-TH')}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Typography variant="h6" sx={{ pt: 1 }}>ประวัติการใช้งานและข้อผิดพลาด</Typography>
          {loadingActivity ? (
            <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress /></Stack>
          ) : activityLogs.length === 0 ? (
            <Alert severity="info">ยังไม่มีประวัติการใช้งานตามตัวกรองนี้</Alert>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" stickyHeader sx={{ minWidth: 1100 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>วันเวลา</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>พนักงาน</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>เหตุการณ์</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>ระดับ</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>หน้า</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>อุปกรณ์</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>รายละเอียด</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredActivityLogs
                    .slice(activityPage * activityRowsPerPage, activityPage * activityRowsPerPage + activityRowsPerPage)
                    .map((log) => {
                    const name = log.profiles?.full_name || log.profiles?.email || 'ไม่ทราบชื่อ'
                    const eventLabel: Record<string, string> = {
                      session_start: 'เริ่มใช้งาน',
                      session_end: 'ออกจากระบบ',
                      page_view: 'เปิดหน้า',
                      client_error: 'ข้อผิดพลาดหน้าเว็บ',
                      request_error: 'การเชื่อมต่อล้มเหลว',
                    }
                    return (
                      <TableRow key={log.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('th-TH')}</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{name}</TableCell>
                        <TableCell>{eventLabel[log.event_type] || log.event_type}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={log.severity === 'error' ? 'ผิดพลาด' : log.severity === 'warning' ? 'คำเตือน' : 'ข้อมูล'}
                            color={log.severity === 'error' ? 'error' : log.severity === 'warning' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{log.page_path || '-'}</TableCell>
                        <TableCell>{log.device_label || 'ไม่ทราบอุปกรณ์'}</TableCell>
                        <TableCell sx={{ maxWidth: 340, wordBreak: 'break-word' }}>{userError(log) || '-'}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <TablePagination
                component="div"
                count={filteredActivityLogs.length}
                page={Math.min(activityPage, Math.max(0, Math.ceil(filteredActivityLogs.length / activityRowsPerPage) - 1))}
                rowsPerPage={activityRowsPerPage}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="แถวต่อหน้า"
                onPageChange={(_event, page) => setActivityPage(page)}
                onRowsPerPageChange={(event) => {
                  setActivityRowsPerPage(Number(event.target.value))
                  setActivityPage(0)
                }}
              />
            </TableContainer>
          )}
          {!loadingActivity && activityLogs.length > 0 && filteredActivityLogs.length === 0 && (
            <Alert severity="info">ไม่พบข้อมูลที่ตรงกับคำค้นหา</Alert>
          )}
        </Stack>
      )}

      <Drawer anchor="right" open={Boolean(employeeDrawer)} onClose={() => setEmployeeDrawer(null)}>
        <Box sx={{ width: { xs: '100vw', sm: 460 }, maxWidth: '100vw', p: 3 }}>
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box>
              <Typography variant="overline" color="text.secondary">ข้อมูลพนักงาน</Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>{employeeDrawer?.full_name || 'ยังไม่ระบุชื่อ'}</Typography>
              <Typography color="text.secondary">{employeeDrawer?.email || 'ไม่มีอีเมล'}</Typography>
            </Box>
            <Button onClick={() => setEmployeeDrawer(null)}>ปิด</Button>
          </Stack>

          <Divider sx={{ my: 2 }} />
          {employeeDrawer && <Stack spacing={2.5}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>ข้อมูลส่วนตัว</Typography>
              <TextField
                fullWidth size="small" label="ชื่อพนักงาน"
                value={names[employeeDrawer.id] ?? ''}
                slotProps={{ htmlInput: { maxLength: 120 } }}
                onChange={(event) => setNames((current) => ({ ...current, [employeeDrawer.id]: event.target.value }))}
              />
              <Button
                sx={{ mt: 1 }} variant="contained" fullWidth
                disabled={savingId === employeeDrawer.id || (names[employeeDrawer.id]?.trim().length ?? 0) < 2}
                onClick={() => void saveName(employeeDrawer)}
              >
                {savingId === employeeDrawer.id ? <CircularProgress size={20} color="inherit" /> : 'บันทึกชื่อ'}
              </Button>
              {canManage && employeeDrawer.id !== user?.id && <Button sx={{ mt: 1 }} variant="outlined" fullWidth onClick={() => openAccountEditor(employeeDrawer)}>แก้ไข Email / Password เข้าระบบ</Button>}
            </Box>

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>เอกสารประจำตัวและเอกสารย้อนหลัง</Typography>
              {(employeeDocumentsByProfile[employeeDrawer.id] ?? []).length === 0
                ? <Typography variant="body2" color="text.secondary">ยังไม่มีเอกสารที่เชื่อมกับพนักงานรายนี้</Typography>
                : <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {(employeeDocumentsByProfile[employeeDrawer.id] ?? []).map((document) => (
                      <Chip
                        key={document.id}
                        size="small"
                        color={document.link_status === 'available' ? 'success' : 'default'}
                        variant="outlined"
                        label={`${intakeDocumentLabels[document.document_type] ?? document.document_type}${document.link_status === 'available' ? '' : ` · ${document.link_status}`}`}
                      />
                    ))}
                  </Stack>}
            </Box>

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>การจ้างงานและหน่วยงาน</Typography>
              <Stack spacing={0.75}>
                <Typography>รหัสพนักงาน: <strong>{employeeDrawer.employee_code || 'ยังไม่กำหนด'}</strong></Typography>
                <Typography>ประเภท: <strong>{employmentLabels[employeeDrawer.employment_type ?? ''] ?? employeeDrawer.employment_type ?? 'ยังไม่กำหนด'}</strong></Typography>
                <Typography>ตำแหน่ง / ฝ่าย: <strong>{employeeDrawer.job_title || '-'}{employeeDrawer.department ? ` · ${employeeDrawer.department}` : ''}</strong></Typography>
                <Typography>ไซต์ที่รับผิดชอบ: <strong>{employeeDrawer.site_count ?? 0} ไซต์</strong></Typography>
              </Stack>
              {canManage && <Button fullWidth variant="outlined" sx={{ mt: 1.5 }} onClick={() => { setEmployeeDrawer(null); void openEmployment(employeeDrawer) }}>แก้ไขข้อมูลการจ้างงาน ค่าจ้าง และนโยบายเวลา</Button>}
            </Box>

            <Divider />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>ความพร้อมและสิทธิ์</Typography>
              {(() => {
                const missing = employeeMissingData(employeeDrawer)
                return missing.length === 0
                  ? <Alert severity="success">ข้อมูลพร้อมสำหรับการทำงาน</Alert>
                  : <Alert severity="warning">ข้อมูลที่ยังขาด: {missing.join(', ')}</Alert>
              })()}
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Chip label={`สิทธิ์ ${employeeDrawer.role}`} />
                <Chip color={employmentStatusColor(employeeDrawer.employment_status)} label={employmentStatusLabel(employeeDrawer.employment_status)} />
                <Chip color={employeeDrawer.membership_active === false ? 'warning' : 'success'} label={employeeDrawer.membership_active === false ? 'สมาชิกปิดใช้งาน' : 'เข้าถึงระบบปกติ'} />
              </Stack>
            </Box>

            {canCreate && <>
              <Divider />
              <Typography variant="subtitle2">การดำเนินการ</Typography>
              <Button variant="outlined" component="a" href={`/reports?employee=${employeeDrawer.id}&add=1`}>เพิ่ม / แก้ไขเวลาทำงาน</Button>
              <Button color="info" variant="outlined" onClick={() => { setEmployeeDrawer(null); void openManageEmployeeScopeOnly(employeeDrawer) }}>เช็ค Cross-company</Button>
              {employeeDrawer.id !== user?.id && <>
                <Button color="warning" variant="contained" onClick={() => { setEmployeeDrawer(null); void openResignEmployee(employeeDrawer) }}>แจ้งลาออก</Button>
                <Button color="warning" variant="outlined" onClick={() => { setEmployeeDrawer(null); void openManageEmployee(employeeDrawer) }}>จัดการสถานะ / ลบข้อมูล</Button>
              </>}
            </>}
          </Stack>}
        </Box>
      </Drawer>

      <Dialog open={Boolean(reviewTarget)} onClose={() => !reviewingId && setReviewTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          {reviewAction === 'approve' ? 'อนุมัติรายการลงเวลา' : reviewAction === 'correct' ? 'เพิ่มเวลาออกย้อนหลัง' : 'ไม่อนุมัติรายการลงเวลา'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              {reviewTarget?.profiles?.full_name || reviewTarget?.profiles?.email} · {reviewTarget?.project_sites?.name}
            </Typography>
            {reviewAction === 'correct' && (
              <TextField type="datetime-local" label="เวลาออกที่ถูกต้อง" value={correctedClockOut}
                onChange={(event) => setCorrectedClockOut(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }} />
            )}
            <TextField multiline minRows={3} label={reviewAction === 'approve' ? 'หมายเหตุ (ถ้ามี)' : 'เหตุผล'}
              value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={Boolean(reviewingId)} onClick={() => setReviewTarget(null)}>ยกเลิก</Button>
          <Button variant="contained" color={reviewAction === 'reject' ? 'error' : 'primary'}
            disabled={Boolean(reviewingId)
              || (reviewAction === 'correct' && !correctedClockOut)
              || (reviewAction !== 'approve' && reviewReason.trim().length < 3)}
            onClick={() => void reviewAttendance()}>
            ยืนยัน
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(manageEmployee)} onClose={() => { if (managing) return; setManageEmployee(null); setManageScopeOnly(false) }} fullWidth maxWidth="sm">
        <DialogTitle>จัดการพนักงาน · {manageEmployee?.full_name||manageEmployee?.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{pt:1}}>
            {manageScopeIssues.length > 0 ? (
              <Alert severity="warning" sx={{ whiteSpace: 'pre-wrap' }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>สรุปปัญหา (pre-check)</Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>{manageScopeSummaryText}</Typography>
                <Typography variant="body2">แนวทาง:</Typography>
                <Typography variant="body2">1) ตรวจข้อมูลบริษัทใน company_members</Typography>
                <Typography variant="body2">2) ตรวจประวัติการจ้างใน employee_employment_records</Typography>
                <Typography variant="body2">3) ตรวจมอบหมายไซต์งานใน employee_site_assignments</Typography>
                <Typography variant="body2">4) ให้ข้อมูลทุกตารางตรงบริษัทเดียวกันก่อนกดยืนยันอีกครั้ง</Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
                  <Button size="small" variant="outlined" onClick={copyManageScopeSummary}>
                    คัดลอกปัญหาการจัดการ
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={() => navigate('/mutation-attempt-center')}
                  >
                    เปิด Mutation Attempt Center
                  </Button>
                </Stack>
              </Alert>
            ) : (
              manageScopeOnly && (
              <Alert severity="success" sx={{ whiteSpace: 'pre-wrap' }}>
                <Typography>Cross-company check: ผ่านแล้ว — ข้อมูลบริษัท/การจ้าง/การมอบหมายไซต์อยู่ในขอบเขตเดียวกัน</Typography>
              </Alert>
              )
            )}
            {!manageScopeOnly && (
              <>
                <Box sx={{ mt: -0.5, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={manageChecking || Boolean(managing)}
                    onClick={() => {
                      if (manageEmployee) {
                        void runManageAllChecks(manageEmployee)
                      }
                    }}
                  >
                    {manageChecking ? <CircularProgress size={18} color="inherit" /> : 'ตรวจสอบทุกอย่างก่อนดำเนินการ'}
                  </Button>
                </Box>
                <TextField select label="การดำเนินการ" value={manageAction} onChange={(e)=>setManageAction(e.target.value as typeof manageAction)}>
                  <MenuItem value="archive">ปิดใช้งาน (แนะนำเมื่อมีประวัติ)</MenuItem>
                  <MenuItem value="resign">พนักงานลาออก (แนะนำเมื่อลาออกจริง)</MenuItem>
                  <MenuItem value="reactivate">เปิดใช้งานอีกครั้ง</MenuItem>
                  {canDeleteEmployee && <MenuItem value="delete" disabled={!managePreview?.can_delete}>ลบถาวร (เฉพาะข้อมูลที่คีย์ผิดและยังไม่เคยใช้งาน)</MenuItem>}
                </TextField>
                {managePreview&&(
                  <Alert severity={managePreview.can_delete ? 'info' : 'error'} sx={{ whiteSpace: 'pre-line' }}>
                    {managePreview.can_delete
                      ? 'ตรวจสอบสำเร็จ: ข้อมูลนี้ผ่านเงื่อนไขการลบถาวร'
                      : (
                        <>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>ไม่สามารถลบถาวรได้ เนื่องจากยังมีข้อมูลอ้างอิงเหล่านี้</Typography>
                          <Box component="ul" sx={{ margin: 0, pl: 3 }}>
                            {buildDeleteBlockReasons(managePreview).map((reason) => (
                              <Box component="li" key={reason} sx={{ mb: 0.5 }}>
                                {reason}
                              </Box>
                            ))}
                          </Box>
                        </>
                      )
                    }
                    {!managePreview.can_delete && (
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        แนวทาง: แนะนำให้ใช้ “ปิดใช้งาน” หรือ “ลาออก” ก่อน, แล้วค่อยจัดการข้อมูลที่เกี่ยวข้องให้หมดก่อนทำลบใหม่
                      </Typography>
                    )}
                  </Alert>
                )}
                {manageAction!=='delete'&&<TextField multiline minRows={2} label="เหตุผล" value={manageReason} onChange={(e)=>setManageReason(e.target.value)} required/>}
                {manageAction!=='resign'&&manageFormIssues.length>0&&(
                  <Alert severity="warning" sx={{ whiteSpace: 'pre-line' }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>ตรวจพบข้อมูลที่ต้องแก้ก่อนส่ง</Typography>
                    <Box component="ul" sx={{ margin: 0, pl: 3 }}>
                      {manageFormIssues.map((issue) => (
                        <Box component="li" key={issue}>{issue}</Box>
                      ))}
                    </Box>
                  </Alert>
                )}
                {manageAction==='resign'&&(
                  <Stack spacing={1}>
                    <Alert severity="info">
                      พนักงานยังลงเวลาได้ถึงวันสุดท้ายทำงาน ระบบจะตัดสิทธิ์ตั้งแต่วันที่ตัดสิทธิ์ และ Payroll จะคิดเงินถึงวันที่กำหนดเท่านั้น
                    </Alert>
                    {manageFormIssues.length>0&&(
                      <Alert severity="warning" sx={{ whiteSpace: 'pre-line' }}>
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>ตรวจพบข้อมูลที่ต้องแก้ก่อนส่ง</Typography>
                        <Box component="ul" sx={{ margin: 0, pl: 3 }}>
                          {manageFormIssues.map((issue) => (
                            <Box component="li" key={issue}>{issue}</Box>
                          ))}
                        </Box>
                      </Alert>
                    )}
                    <Stack direction={{xs:'column',sm:'row'}} spacing={1}>
                      <TextField type="date" label="วันสุดท้ายทำงาน" value={lastWorkingOn} onChange={e=>{
                        const value = e.target.value
                        setLastWorkingOn(value)
                        setPayrollEligibleUntil(value)
                        if (value) {
                          const nextDay = new Date(`${value}T00:00:00`)
                          nextDay.setDate(nextDay.getDate() + 1)
                          setStatusEffectiveOn(nextDay.toISOString().slice(0,10))
                        }
                      }} slotProps={{inputLabel:{shrink:true}}} required/>
                      <TextField type="date" label="วันที่ตัดสิทธิ์ / เข้าใช้งานไม่ได้" value={statusEffectiveOn} onChange={e=>setStatusEffectiveOn(e.target.value)} helperText="ต้องเป็นวันถัดจากวันสุดท้ายทำงานหรือหลังจากนั้น" error={Boolean(lastWorkingOn&&statusEffectiveOn&&statusEffectiveOn<=lastWorkingOn)} slotProps={{inputLabel:{shrink:true}}} required/>
                      <TextField type="date" label="คิดเงินถึงวันที่" value={payrollEligibleUntil} onChange={e=>setPayrollEligibleUntil(e.target.value)} helperText="รองรับย้อนหลัง เช่น บันทึก 25 แต่คิดถึง 16" slotProps={{inputLabel:{shrink:true}}} required/>
                    </Stack>
                  </Stack>
                )}
                {manageAction==='delete'&&managePreview?.can_delete===true&&(
                  <Alert severity="error">การลบถาวรย้อนกลับไม่ได้ และใช้ได้เฉพาะบัญชีที่ไม่มีประวัติการทำงาน</Alert>
                )}
                {manageAction==='delete'&&managePreview?.can_delete===false&&(
                  <Alert severity="warning">
                    ปิดใช้งาน/ลาออกจะปลอดภัยกว่าในตอนนี้ หากต้องการลบจริง ๆ จึงต้องล้างหรือย้ายข้อมูลที่ผูกไว้ทั้งหมดแล้วลองใหม่
                  </Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setManageEmployee(null); setManageScopeOnly(false) }}>ปิด</Button>
          {manageScopeOnly ? null : (
          <Button color={manageAction==='delete'?'error':'primary'} variant="contained" disabled={managing || manageFormIssues.length>0} onClick={()=>void submitEmployeeAction()}>{managing?<CircularProgress size={20} color="inherit"/>:'ยืนยัน'}</Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(employmentEmployee)} onClose={() => !employmentSaving && setEmploymentEmployee(null)} fullWidth maxWidth="md">
        <DialogTitle>ข้อมูลการจ้างงาน · {employmentEmployee?.full_name || employmentEmployee?.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth label="รหัสพนักงาน" value={employmentForm.employee_code}
                onChange={(event) => setEmploymentForm({ ...employmentForm, employee_code: event.target.value })} />
              <TextField fullWidth select label="ประเภทการจ้าง" value={employmentForm.employment_type}
                onChange={(event) => setEmploymentForm({ ...employmentForm, employment_type: event.target.value })}>
                <MenuItem value="daily">รายวัน</MenuItem><MenuItem value="monthly">รายเดือน</MenuItem>
                <MenuItem value="temporary">ชั่วคราว</MenuItem><MenuItem value="contractor">ผู้รับเหมา</MenuItem>
              </TextField>
              <TextField fullWidth select label="สถานะ" value={employmentForm.employment_status}
                onChange={(event) => setEmploymentForm({ ...employmentForm, employment_status: event.target.value })}>
                <MenuItem value="preboarding">เตรียมเริ่มงาน</MenuItem><MenuItem value="probation">ทดลองงาน</MenuItem>
                <MenuItem value="active">ทำงาน</MenuItem><MenuItem value="suspended">พักงาน</MenuItem>
                <MenuItem value="notice">แจ้งออก</MenuItem><MenuItem value="terminated">สิ้นสุดงาน</MenuItem>
                <MenuItem value="archived">เก็บประวัติ</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth label="ตำแหน่ง" value={employmentForm.job_title}
                onChange={(event) => setEmploymentForm({ ...employmentForm, job_title: event.target.value })} />
              <TextField fullWidth label="แผนก" value={employmentForm.department}
                onChange={(event) => setEmploymentForm({ ...employmentForm, department: event.target.value })} />
            </Stack>
            <TextField fullWidth select label="นโยบายลงเวลา" value={employmentForm.attendance_policy}
              onChange={(event) => setEmploymentForm({ ...employmentForm, attendance_policy: event.target.value, ...(event.target.value === 'exempt' ? { work_policy_id: '' } : {}) })}
              helperText="กำหนดว่าข้อมูลเวลามีผลต่อค่าจ้างและการแจ้งเตือนอย่างไร">
              <MenuItem value="required">ต้องลงเวลาและมีผลต่อค่าจ้าง</MenuItem>
              <MenuItem value="record_only">ลงเวลาเพื่อบันทึก/กระจายต้นทุน ไม่หักเงินอัตโนมัติ</MenuItem>
              <MenuItem value="exempt">ไม่ต้องลงเวลาและไม่สร้างการแจ้งเตือน</MenuItem>
            </TextField>
            {employmentForm.attendance_policy !== 'exempt' ? <TextField fullWidth select label="ตารางเวลาทำงาน" value={employmentForm.work_policy_id}
              onChange={(event) => setEmploymentForm({ ...employmentForm, work_policy_id: event.target.value })}
              helperText={workPolicies.length ? 'ใช้คำนวณเวลาเข้างาน สาย เวลาปกติ และ OT' : 'ยังไม่มีตารางเวลา กรุณาสร้างที่เมนู กำหนดเวลางานและรอบจ่าย'}>
              <MenuItem value=""><em>ยังไม่กำหนด</em></MenuItem>
              {workPolicies.map((policy)=><MenuItem key={policy.id} value={policy.id}>{policy.name}</MenuItem>)}
            </TextField> : <Alert severity="info">พนักงานนี้ไม่ต้องลงเวลา จึงไม่จำเป็นต้องกำหนดตารางเวลาทำงาน</Alert>}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth type="date" label="วันที่เริ่มงาน" value={employmentForm.hired_on}
                onChange={(event) => setEmploymentForm({ ...employmentForm, hired_on: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }} />
              <TextField fullWidth type="date" label="สิ้นสุดทดลองงาน" value={employmentForm.probation_ends_on}
                onChange={(event) => setEmploymentForm({ ...employmentForm, probation_ends_on: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }} />
              <TextField fullWidth type="date" label="สิ้นสุดสัญญา" value={employmentForm.contract_ends_on}
                onChange={(event) => setEmploymentForm({ ...employmentForm, contract_ends_on: event.target.value })}
                slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField fullWidth type="number" label="ค่าแรงรายวัน" value={employmentForm.daily_rate}
                onChange={(event) => setEmploymentForm({ ...employmentForm, daily_rate: event.target.value })} />
              <TextField fullWidth type="number" label="เงินเดือน" value={employmentForm.monthly_salary}
                onChange={(event) => setEmploymentForm({ ...employmentForm, monthly_salary: event.target.value })} />
              <TextField fullWidth type="number" label="อัตรา OT/ชั่วโมง" value={employmentForm.overtime_hourly_rate}
                onChange={(event) => setEmploymentForm({ ...employmentForm, overtime_hourly_rate: event.target.value })} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={employmentSaving} onClick={() => setEmploymentEmployee(null)}>ยกเลิก</Button>
          <Button variant="contained" disabled={employmentSaving || !employmentForm.employee_code.trim() || (employmentForm.attendance_policy !== 'exempt' && !employmentForm.work_policy_id)}
            onClick={() => void saveEmployment()}>
            {employmentSaving ? <CircularProgress size={22} color="inherit" /> : 'บันทึกข้อมูลการจ้างงาน'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(accountEmployee)} onClose={() => !accountSaving && setAccountEmployee(null)} fullWidth maxWidth="sm">
        <DialogTitle>แก้ไขบัญชีเข้าสู่ระบบ · {accountEmployee?.full_name || accountEmployee?.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField fullWidth label="Email ใหม่" type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} />
            <TextField fullWidth label="Password ใหม่" type="password" autoComplete="new-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} helperText="อย่างน้อย 10 ตัวอักษร" />
            <TextField fullWidth label="ยืนยัน Password ใหม่" type="password" autoComplete="new-password" value={accountPasswordConfirm} onChange={(event) => setAccountPasswordConfirm(event.target.value)} />
            <Alert severity="warning">การบันทึกจะเปลี่ยนข้อมูล Login ของพนักงานทันที</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={accountSaving} onClick={() => setAccountEmployee(null)}>ยกเลิก</Button>
          <Button variant="contained" disabled={accountSaving || !accountEmail.trim() || accountPassword.length < 10 || accountPassword !== accountPasswordConfirm} onClick={() => void saveEmployeeAccount()}>{accountSaving ? <CircularProgress size={20} color="inherit" /> : 'บันทึกบัญชี'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(intakeDraftPerson)} onClose={() => !intakeDraftSaving && setIntakeDraftPerson(null)} fullWidth maxWidth="sm">
        <DialogTitle>เพิ่ม / อัปเดตข้อมูลก่อนเริ่มงาน</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">รายการนี้เป็นประวัติเบื้องต้น ยังไม่เปิด Login ลงเวลา หรือคิดค่าแรง จนกว่า Admin จะยืนยันขั้นสุดท้าย</Alert>
          <TextField required label="ชื่อพนักงาน" value={intakeDraft.full_name} onChange={(e) => setIntakeDraft((v) => ({ ...v, full_name: e.target.value }))} />
          <TextField required label="เบอร์โทร" value={intakeDraft.phone} onChange={(e) => setIntakeDraft((v) => ({ ...v, phone: e.target.value }))} />
          <TextField required select label="ประเภทการจ้าง" value={intakeDraft.employment_type} onChange={(e) => setIntakeDraft((v) => ({ ...v, employment_type: e.target.value }))}>
            <MenuItem value="unknown" disabled>ยังไม่ระบุ</MenuItem><MenuItem value="daily">รายวัน</MenuItem><MenuItem value="monthly">รายเดือน</MenuItem><MenuItem value="temporary">ชั่วคราว</MenuItem><MenuItem value="contractor">ผู้รับเหมา</MenuItem>
          </TextField>
          <TextField required label="ตำแหน่ง" value={intakeDraft.position} onChange={(e) => setIntakeDraft((v) => ({ ...v, position: e.target.value }))} />
          <TextField required type="date" label="วันที่เริ่มงาน" value={intakeDraft.start_date} onChange={(e) => setIntakeDraft((v) => ({ ...v, start_date: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
          <Typography variant="caption" color="text.secondary">เอกสารที่เชื่อมแล้ว: {intakeDraftPerson?.documents.length ?? 0} รายการ · Intake และ Audit เดิมจะถูกเก็บครบ</Typography>
        </Stack></DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap' }}><Button disabled={intakeDraftSaving} onClick={() => setIntakeDraftPerson(null)}>ยกเลิก</Button><Button variant="outlined" disabled={intakeDraftSaving || !intakeDraft.full_name.trim()} onClick={() => void saveIntakeDraft()}>{intakeDraftSaving ? <CircularProgress size={20} color="inherit" /> : 'บันทึกร่าง'}</Button><Button variant="contained" disabled={intakeDraftSaving || !intakeDraft.full_name.trim() || !intakeDraft.phone.trim() || intakeDraft.employment_type === 'unknown' || !intakeDraft.position.trim() || !intakeDraft.start_date} onClick={() => { if (window.confirm('ยืนยันว่าข้อมูลครบและส่งเข้าสู่ Onboarding ขั้นถัดไปใช่ไหม')) void saveIntakeDraft(true) }}>บันทึกและยืนยันข้อมูลครบ</Button></DialogActions>
      </Dialog>

      <Dialog
        open={createOpen}
        onClose={() => {
          if (creating) return
          setCreateOpen(false)
          setCreateEmployeeAction('')
          setCreateEmployeeErrorCode('')
          setCreateEmployeeRawError('')
          setErrorMessage('')
          setDryRunResult(null)
          setDryRunResultError('')
          setDryRunConfirmed(false)
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>เพิ่มพนักงานใหม่</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              ระบบจะยืนยันอีเมลให้พร้อมใช้งานทันที กรุณาส่งรหัสผ่านชั่วคราวให้พนักงานเป็นการส่วนตัว
            </Alert>
            {!!createEmployeePreflightIssues.filter((issue) => issue.blocking).length && (
              <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
                <Typography sx={{ mb: 1 }}>
                  ยังไม่พร้อมส่งข้อมูล: กรุณาแก้ปัญหาต่อไปนี้ก่อนกดส่ง
                </Typography>
                {createEmployeePreflightIssues.filter((issue) => issue.blocking || issue.severity === 'error').map((issue) => (
                  <Typography key={issue.code} variant="body2">• {issue.message}{issue.action ? ` (${issue.action})` : ''}</Typography>
                ))}
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ mt: 1 }}
                  onClick={() => {
                    const preflight = createEmployeePreflightResult()
                    setCreateEmployeePreflightIssues(preflight.issues)
                  }}
                >
                  รีเช็คข้อมูล
                </Button>
              </Alert>
            )}
            {createEmployeeErrorCode ? <Alert severity="warning">
              <Stack spacing={1}>
                <Typography>{getCreateEmployeeRecoverySuggestion(createEmployeeErrorCode || undefined) || 'ระบบแจ้งข้อผิดพลาด กรุณาตรวจสอบและลองอีกครั้ง'}</Typography>
                {createEmployeeAction ? <Typography variant="body2">แนวทางเพิ่มเติมจากระบบ: {createEmployeeAction}</Typography> : null}
                {createEmployeeRawError ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>รายละเอียด: {createEmployeeRawError}</Typography> : null}
                <Button
                  variant="outlined"
                  onClick={handleCreateEmployeeRecoveryAction}
                  disabled={creating}
                  size="small"
                >
                  {getCreateEmployeeRecoveryButtonLabel(createEmployeeErrorCode || undefined)}
                </Button>
              </Stack>
            </Alert> : null}
            {dryRunResultError ? <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
              <Typography>{dryRunResultError}</Typography>
              <Button disabled={creatingDryRun} size="small" variant="outlined" onClick={() => void runCreateEmployeeDryRun()}>
                {creatingDryRun ? <CircularProgress size={18} color="inherit" /> : 'ลองทดสอบใหม่'}
              </Button>
            </Alert> : null}
              {dryRunResult ? <Alert severity="success">
                <Typography variant="subtitle2" sx={{ mb: 1 }}>ผลการทดสอบ Dry-run</Typography>
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  สถานะ: {dryRunResult.plan.will_write ? 'กำลังเขียนจริง' : 'ผ่าน dry-run (ไม่เขียนข้อมูลลง DB)'}
                </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableBody>
                    {buildDryRunSummaryRows(dryRunResult.plan).map(([name, value]) => (
                      <TableRow key={name}>
                        <TableCell sx={{ width: '45%', fontWeight: 600 }}>{name}</TableCell>
                        <TableCell sx={{ whiteSpace: 'pre-line' }}>{value}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {!dryRunConfirmed ? (
                <Button
                  variant="outlined"
                  size="small"
                  sx={{ mt: 1.5 }}
                  onClick={() => setDryRunConfirmed(true)}
                  disabled={creatingDryRun || creating}
                >
                  ยืนยันผล dry-run นี้แล้วสร้างจริง
                </Button>
              ) : (
                <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>
                  ยืนยันแล้ว: คุณสามารถกดสร้างบัญชีได้
                </Typography>
              )}
            </Alert> : null}
              <TextField
                autoFocus
                required
                label="ชื่อ-นามสกุล"
                value={newEmployee.fullName}
                onChange={(event) => {
                  setNewEmployee((current) => ({ ...current, fullName: event.target.value }))
                  clearCreateDiagnostics()
                }}
              />
              <TextField
                required
                type="email"
                label="อีเมล"
                autoComplete="off"
                value={newEmployee.email}
                onChange={(event) => {
                  setNewEmployee((current) => ({ ...current, email: event.target.value }))
                  clearCreateDiagnostics()
                }}
              />
              <TextField
                required
                type="password"
                label="รหัสผ่านชั่วคราว"
                autoComplete="new-password"
                value={newEmployee.password}
                onChange={(event) => {
                  setNewEmployee((current) => ({ ...current, password: event.target.value }))
                  clearCreateDiagnostics()
                }}
                helperText="อย่างน้อย 10 ตัวอักษร และไม่ควรใช้รหัสเดียวกันกับพนักงานคนอื่น"
              />
            <TextField
              select
              label="สิทธิ์ผู้ใช้งาน"
              value={newEmployee.role}
              onChange={(event) => {
                setNewEmployee((current) => ({ ...current, role: event.target.value as 'employee' | 'manager' }))
                clearCreateDiagnostics()
              }}
            >
              <MenuItem value="employee">พนักงาน</MenuItem>
              <MenuItem value="manager">ผู้จัดการ</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={creating}
            onClick={() => {
              setCreateOpen(false)
              setCreateEmployeeAction('')
              setCreateEmployeeErrorCode('')
              setCreateEmployeeRawError('')
              setErrorMessage('')
            }}
          >
            ยกเลิก
          </Button>
            <Button
              variant="contained"
              disabled={
                (Boolean(dryRunResult) && !dryRunConfirmed) ||
                creating
                || newEmployee.fullName.trim().length < 2
                || newEmployee.email.trim().length < 5
                || newEmployee.password.length < 10
              }
              onClick={requestCreateEmployee}
            >
              {creating ? <CircularProgress size={22} color="inherit" /> : 'สร้างบัญชีพนักงาน'}
            </Button>
          <Button
            variant="outlined"
            disabled={
              creatingDryRun
              || creating
              || newEmployee.fullName.trim().length < 2
              || newEmployee.email.trim().length < 5
              || newEmployee.password.length < 10
            }
            onClick={() => void runCreateEmployeeDryRun()}
          >
            {creatingDryRun ? <CircularProgress size={22} color="inherit" /> : 'ทดสอบ dry-run'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

