import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Chip, Divider, Drawer, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Employee = {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'manager' | 'employee'
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
type WorkPolicyOption = { id: string; name: string; active: boolean }
type CreateEmployeeError = {
  error: string
  error_code: string
  action: string
}
type CreateEmployeeErrorCode =
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
  | 'INVALID_PASSWORD'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'AUTH_CREATE_FAILED'
  | 'UNHANDLED'
  | 'UNKNOWN_ERROR'
type CreateEmployeeSuccess = {
  ok: true
  employee: {
    id: string
    email: string
    full_name: string
    role: 'employee' | 'manager'
    company_id: string
  }
}
type EmploymentForm = {
  employee_code: string; employment_type: string; job_title: string; department: string
  hired_on: string; probation_ends_on: string; contract_ends_on: string
  employment_status: string; attendance_policy: string; work_policy_id: string
  daily_rate: string; monthly_salary: string; overtime_hourly_rate: string
}

const getCreateEmployeeErrorMessage = (payload?: CreateEmployeeError | null, raw?: string) => {
  const message = payload?.error ?? raw ?? 'ไม่สามารถเพิ่มพนักงานได้'
  const action = payload?.action
  const code = payload?.error_code ?? 'UNKNOWN_ERROR'
  const fallbackAction = {
    INVALID_EMAIL: 'กรุณาใส่อีเมลให้ถูกต้อง เช่น name@domain.com และลองกดสร้างอีกครั้ง',
    INVALID_NAME: 'ชื่อพนักงานต้องยาวอย่างน้อย 2 ตัวอักษร แก้ชื่อให้ครบถ้วนแล้วลองใหม่',
    INVALID_PASSWORD: 'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 10 ตัวอักษร (แนะนำใช้ตัวอักษรผสมตัวเลข/อักษรพิเศษ)',
    AUTH_REQUIRED: 'กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้งเพื่อต่ออายุ token',
    PERMISSION_DENIED: 'ตรวจสิทธิ์ผู้ใช้งาน/บริษัทที่เลือกว่าเป็น Admin/Manager/Executive และสถานะยัง Active อยู่',
    EMAIL_ALREADY_EXISTS: 'อีเมลนี้ถูกใช้ไปแล้ว ให้เลือกอีเมลใหม่ หรือปิดบัญชีเดิมก่อนเพิ่มใหม่',
    AUTH_CREATE_FAILED: 'การตั้งค่าฝั่ง Auth มีปัญหา ให้กดรีเฟรชหน้าและลองอีกครั้ง หรือติดต่อผู้ดูแลระบบ',
    UNHANDLED: 'ตรวจข้อมูลที่กรอกและลองสร้างพนักงานอีกครั้ง หากยังคงเกิดซ้ำให้บันทึก error นี้แล้วแจ้งทีมผู้ดูแลระบบ',
  }[code] ?? 'ตรวจข้อมูลที่กรอกและลองสร้างพนักงานอีกครั้ง'

  const base = `ไม่สามารถเพิ่มพนักงานได้: ${message}`
  const suggestion = action || fallbackAction
  return `${base}\nแนวทางแก้: ${suggestion}`
}

const getCreateEmployeeRecoverySuggestion = (code: CreateEmployeeErrorCode | undefined) => {
  if (!code) return ''
  if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_DENIED') return 'กดปุ่ม “ออก/เข้าสู่ระบบใหม่” เพื่อรีเฟรชสิทธิ์ทันที'
  if (code === 'EMAIL_ALREADY_EXISTS') return 'กดปุ่ม “เปลี่ยนอีเมล” แล้วกรอกอีเมลใหม่ แล้วลองอีกครั้ง'
  if (code === 'INVALID_EMAIL') return 'กดปุ่ม “เช็ครูปแบบอีเมล” เพื่อตรวจรูปแบบและลองอีกครั้ง'
  if (code === 'INVALID_NAME') return 'กดปุ่ม “ตั้งชื่อใหม่” เพื่อแก้ชื่อตามรูปแบบที่ระบบรับได้'
  if (code === 'INVALID_PASSWORD') return 'กดปุ่ม “ตั้งรหัสใหม่” โดยใช้รหัสผ่านอย่างน้อย 10 ตัวอักษร'
  return 'กดปุ่ม “ลองอีกครั้ง” โดยคงข้อมูลเดิมหรือแก้ไขข้อมูลที่ยังค้างก่อนส่งใหม่'
}

const getCreateEmployeeRecoveryButtonLabel = (code: CreateEmployeeErrorCode | undefined) => {
  if (!code) return 'ลองอีกครั้ง'
  if (code === 'AUTH_REQUIRED' || code === 'PERMISSION_DENIED') return 'ออก/เข้าสู่ระบบใหม่'
  if (code === 'EMAIL_ALREADY_EXISTS') return 'เปลี่ยนอีเมล'
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
const employeeMissingData = (employee: Employee) => [
  !employee.employment_type && 'ประเภทการจ้าง',
  employee.attendance_policy !== 'exempt' && !employee.has_work_policy && 'ตารางเวลาทำงาน',
  (employee.site_count ?? 0) < 1 && 'ไซต์งาน',
].filter(Boolean) as string[]

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

export function EmployeePage() {
  usePageTitle('พนักงาน')
  const { user, profile, refreshProfile, currentCompany, signOut } = useAuth()
  const [searchParams,setSearchParams]=useSearchParams()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const canCreate = profile?.role === 'admin'
  const [employees, setEmployees] = useState<Employee[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [employeeDrawer, setEmployeeDrawer] = useState<Employee | null>(null)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [createEmployeeErrorCode, setCreateEmployeeErrorCode] = useState<CreateEmployeeErrorCode | ''>('')
  const [createEmployeeAction, setCreateEmployeeAction] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'employee' as 'employee' | 'manager',
  })
  const [employmentEmployee, setEmploymentEmployee] = useState<Employee | null>(null)
  const [employmentForm, setEmploymentForm] = useState<EmploymentForm>(emptyEmployment)
  const [workPolicies, setWorkPolicies] = useState<WorkPolicyOption[]>([])
  const [employmentSaving, setEmploymentSaving] = useState(false)
  const [manageEmployee,setManageEmployee]=useState<Employee|null>(null)
  const [manageAction,setManageAction]=useState<'archive'|'reactivate'|'delete'>('archive')
  const [manageReason,setManageReason]=useState('')
  const [managePreview,setManagePreview]=useState<Record<string,number|boolean>|null>(null)
  const [managing,setManaging]=useState(false)
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

  const loadEmployees = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const query = supabase
      .from('profiles')
      .select('id,full_name,email,role')
      .order('full_name', { ascending: true, nullsFirst: false })
    if (!canManage) query.eq('id', user.id)
    const [profileResult,employmentResult,assignmentResult,readinessResult]=await Promise.all([
      query,
      supabase.from('employee_employment_records').select('profile_id,employee_code,employment_type,job_title,department,employment_status,attendance_policy,work_policy_id').eq('company_id',currentCompany?.company_id ?? ''),
      supabase.from('employee_site_assignments').select('profile_id').eq('company_id',currentCompany?.company_id ?? '').eq('active',true),
      supabase.from('employee_onboarding_readiness').select('profile_id,has_work_policy,ready_to_clock').eq('company_id',currentCompany?.company_id ?? ''),
    ])
    if (profileResult.error||employmentResult.error||assignmentResult.error||readinessResult.error) {
      setErrorMessage(profileResult.error?.message||employmentResult.error?.message||assignmentResult.error?.message||readinessResult.error?.message||'โหลดข้อมูลพนักงานไม่สำเร็จ')
    } else {
      const employmentMap=new Map((employmentResult.data??[]).map(row=>[row.profile_id,row]))
      const readinessMap=new Map((readinessResult.data??[]).map(row=>[row.profile_id,row]))
      const siteCounts=new Map<string,number>();for(const row of assignmentResult.data??[])siteCounts.set(row.profile_id,(siteCounts.get(row.profile_id)??0)+1)
      const rows = (profileResult.data ?? []).map(row=>({...row,...employmentMap.get(row.id),...readinessMap.get(row.id),site_count:siteCounts.get(row.id)??0})) as Employee[]
      setEmployees(rows)
      setNames(Object.fromEntries(rows.map((employee) => [employee.id, employee.full_name ?? ''])))
    }
    setLoading(false)
  }, [canManage, currentCompany?.company_id, user])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEmployees()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadEmployees])

  const saveName = async (employee: Employee) => {
    setSavingId(employee.id)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase.rpc('set_profile_full_name', {
      target_profile_id: employee.id,
      new_full_name: names[employee.id] ?? '',
    })
    if (error) {
      setErrorMessage(error.message)
    } else {
      setMessage(`บันทึกชื่อ ${names[employee.id]} แล้ว ข้อความ LINE ครั้งถัดไปจะแสดงชื่อนี้`)
      await loadEmployees()
      if (employee.id === user?.id) await refreshProfile()
    }
    setSavingId('')
  }

  const createEmployee = async () => {
    setCreating(true)
    setMessage('')
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
    const result = await supabase.functions.invoke<CreateEmployeeSuccess | CreateEmployeeError>('create-employee', {
      body: newEmployee,
    })
    if (result.error || ('error' in (result.data ?? {}))) {
      let serverError = result.data && 'error' in result.data
        ? (result.data as CreateEmployeeError)
        : null
      if (!serverError && result.error?.context instanceof Response) {
        try {
          serverError = await result.error.context.json()
        } catch {
          serverError = null
        }
      }
      const fallbackError = result.error instanceof Error ? result.error.message : 'ไม่สามารถเพิ่มพนักงานได้'
      setErrorMessage(getCreateEmployeeErrorMessage(serverError, fallbackError))
      setCreateEmployeeAction(serverError?.action ?? '')
      setCreateEmployeeErrorCode((serverError?.error_code as CreateEmployeeErrorCode | undefined) ?? 'UNKNOWN_ERROR')
    } else {
      setMessage(`สร้างบัญชี ${newEmployee.fullName} สำเร็จ กรุณาส่งอีเมลและรหัสผ่านชั่วคราวให้พนักงานด้วยช่องทางส่วนตัว`)
      setCreateOpen(false)
      setNewEmployee({ fullName: '', email: '', password: '', role: 'employee' })
      setCreateEmployeeAction('')
      setCreateEmployeeErrorCode('')
      await loadEmployees()
    }
    setCreating(false)
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
    if (error) setErrorMessage(error.message)
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
      setErrorMessage(reloginError instanceof Error ? reloginError.message : 'ไม่สามารถออกจากระบบเพื่อเข้าสู่ระบบใหม่ได้')
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
  }

  const clearCreateEmployeeField = (field: 'fullName' | 'email' | 'password') => {
    setNewEmployee((current) => ({ ...current, [field]: '' }))
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
  }

  const tryCreateEmployeeAgain = () => {
    setErrorMessage('')
    setCreateEmployeeAction('')
    setCreateEmployeeErrorCode('')
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
    setEmploymentSaving(true); setErrorMessage(''); setMessage('')
    const { error } = await supabase.from('employee_employment_records').upsert({
      company_id: currentCompany?.company_id,
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
    }, { onConflict: 'company_id,profile_id' })
    if (error) setErrorMessage(error.message)
    else { setMessage('บันทึกข้อมูลการจ้างงานและรีเฟรชข้อมูลแล้ว'); setEmploymentEmployee(null); await loadEmployees() }
    setEmploymentSaving(false)
  }

  const openManageEmployee=async(employee:Employee)=>{
    setManageEmployee(employee);setManageAction('archive');setManageReason('');setManagePreview(null);setErrorMessage('')
    const {data,error}=await supabase.rpc('employee_delete_preview',{target_profile_id:employee.id})
    if(error)setErrorMessage(error.message)
    else setManagePreview(data as Record<string,number|boolean>)
  }
  const submitEmployeeAction=async()=>{
    if(!manageEmployee)return
    setManaging(true);setErrorMessage('');setMessage('')
    const {data,error}=await supabase.functions.invoke('manage-employee',{body:{profileId:manageEmployee.id,action:manageAction,reason:manageReason}})
    let detail=data?.error||''
    if(error&&'context' in error){
      try{const body=await (error.context as Response).clone().json();detail=body?.error||detail}catch{/* use SDK message */}
    }
    if(error||data?.error)setErrorMessage(detail||error?.message||'ไม่สามารถจัดการพนักงานได้')
    else{setMessage(`${manageAction==='delete'?'ลบข้อมูลที่คีย์ผิดแล้ว':manageAction==='archive'?'ปิดใช้งานพนักงานแล้ว':'เปิดใช้งานพนักงานแล้ว'}${data?.warning?` · ${data.warning}`:''}`);setManageEmployee(null);await loadEmployees()}
    setManaging(false)
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
    if (logResult.error || correctionResult.error) setErrorMessage(logResult.error?.message ?? correctionResult.error?.message ?? 'โหลดข้อมูลไม่สำเร็จ')
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
    if (queryError) setErrorMessage(queryError.message)
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
    if (error) setErrorMessage(error.message)
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
    if (error) setErrorMessage(error.message)
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
      log.message,
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
      log.message || '',
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
        action={canCreate && tab === 0 ? <Button
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
        </Button> : undefined}
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
        <StandardDataTable
          rows={employees}
          getRowId={(employee) => employee.id}
          getSearchText={(employee) => `${employee.employee_code??''} ${employee.full_name ?? ''} ${employee.email ?? ''} ${employee.employment_type??''} ${employee.job_title??''} ${employee.department??''} ${employee.role}`}
          searchLabel="ค้นหารหัส ชื่อ ประเภทจ้าง ตำแหน่ง หรือสิทธิ์"
          emptyText="ยังไม่มีรายชื่อพนักงาน"
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
                <Typography variant="caption" color="text.secondary">{employee.employment_status || 'ยังไม่กำหนดสถานะ'}</Typography>
              </Stack>,
              exportValue: employee => `${employmentLabels[employee.employment_type ?? ''] ?? employee.employment_type ?? ''} ${employee.employment_status || ''}`,
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
                <Chip size="small" label={employee.role} />
                <Chip size="small" color={employee.employment_status === 'active' ? 'success' : 'default'} label={employee.employment_status || 'ยังไม่กำหนด'} />
              </Stack>,
              exportValue: employee => `${employee.role} ${employee.employment_status || ''}`,
            },
            {
              id: 'actions', label: 'จัดการ', minWidth: 105,
              render: employee => <Button size="small" variant="outlined" onClick={() => setEmployeeDrawer(employee)}>ดู / จัดการ</Button>,
            },
          ]}
        />
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
                        <TableCell sx={{ maxWidth: 340, wordBreak: 'break-word' }}>{log.message || '-'}</TableCell>
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
                <Chip color={employeeDrawer.employment_status === 'active' ? 'success' : 'default'} label={employeeDrawer.employment_status || 'ยังไม่กำหนดสถานะ'} />
              </Stack>
            </Box>

            {canCreate && <>
              <Divider />
              <Typography variant="subtitle2">การดำเนินการ</Typography>
              <Button variant="outlined" component="a" href={`/reports?employee=${employeeDrawer.id}&add=1`}>เพิ่ม / แก้ไขเวลาทำงาน</Button>
              {employeeDrawer.id !== user?.id && <Button color="warning" variant="outlined" onClick={() => { setEmployeeDrawer(null); void openManageEmployee(employeeDrawer) }}>ปิดใช้งาน / ลบข้อมูล</Button>}
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

      <Dialog open={Boolean(manageEmployee)} onClose={()=>!managing&&setManageEmployee(null)} fullWidth maxWidth="sm">
        <DialogTitle>จัดการพนักงาน · {manageEmployee?.full_name||manageEmployee?.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{pt:1}}>
            <TextField select label="การดำเนินการ" value={manageAction} onChange={(e)=>setManageAction(e.target.value as typeof manageAction)}>
              <MenuItem value="archive">ปิดใช้งาน (แนะนำเมื่อมีประวัติ)</MenuItem>
              <MenuItem value="reactivate">เปิดใช้งานอีกครั้ง</MenuItem>
              <MenuItem value="delete" disabled={!managePreview?.can_delete}>ลบถาวร (เฉพาะข้อมูลที่คีย์ผิดและยังไม่เคยใช้งาน)</MenuItem>
            </TextField>
            {managePreview&&<Alert severity={managePreview.can_delete?'info':'warning'}>
              ลงเวลา {String(managePreview.attendance??0)} · ลา {String(managePreview.leave_requests??0)} · OT {String(managePreview.overtime??0)} · ค่าจ้าง {String(managePreview.payrolls??0)} · เอกสาร {String(managePreview.documents??0)}
              {!managePreview.can_delete&&' — มีประวัติแล้วจึงลบถาวรไม่ได้ ให้ปิดใช้งานแทน'}
            </Alert>}
            {manageAction!=='delete'&&<TextField multiline minRows={2} label="เหตุผล" value={manageReason} onChange={(e)=>setManageReason(e.target.value)} required/>}
            {manageAction==='delete'&&<Alert severity="error">การลบถาวรย้อนกลับไม่ได้ และใช้ได้เฉพาะบัญชีที่ไม่มีประวัติการทำงาน</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={()=>setManageEmployee(null)}>ยกเลิก</Button><Button color={manageAction==='delete'?'error':'primary'} variant="contained" disabled={managing||(manageAction!=='delete'&&!manageReason.trim())||(manageAction==='delete'&&!managePreview?.can_delete)} onClick={()=>void submitEmployeeAction()}>{managing?<CircularProgress size={20} color="inherit"/>:'ยืนยัน'}</Button></DialogActions>
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

      <Dialog
        open={createOpen}
        onClose={() => {
          if (creating) return
          setCreateOpen(false)
          setCreateEmployeeAction('')
          setCreateEmployeeErrorCode('')
          setErrorMessage('')
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
            {createEmployeeErrorCode ? <Alert severity="warning">
              <Stack spacing={1}>
                <Typography>{getCreateEmployeeRecoverySuggestion(createEmployeeErrorCode || undefined) || 'ระบบแจ้งข้อผิดพลาด กรุณาตรวจสอบและลองอีกครั้ง'}</Typography>
                {createEmployeeAction ? <Typography variant="body2">แนวทางเพิ่มเติมจากระบบ: {createEmployeeAction}</Typography> : null}
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
            <TextField
              autoFocus
              required
              label="ชื่อ-นามสกุล"
              value={newEmployee.fullName}
              onChange={(event) => setNewEmployee((current) => ({ ...current, fullName: event.target.value }))}
            />
            <TextField
              required
              type="email"
              label="อีเมล"
              autoComplete="off"
              value={newEmployee.email}
              onChange={(event) => setNewEmployee((current) => ({ ...current, email: event.target.value }))}
            />
            <TextField
              required
              type="password"
              label="รหัสผ่านชั่วคราว"
              autoComplete="new-password"
              value={newEmployee.password}
              onChange={(event) => setNewEmployee((current) => ({ ...current, password: event.target.value }))}
              helperText="อย่างน้อย 10 ตัวอักษร และไม่ควรใช้รหัสเดียวกันกับพนักงานคนอื่น"
            />
            <TextField
              select
              label="สิทธิ์ผู้ใช้งาน"
              value={newEmployee.role}
              onChange={(event) => setNewEmployee((current) => ({
                ...current,
                role: event.target.value as 'employee' | 'manager',
              }))}
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
              setErrorMessage('')
            }}
          >
            ยกเลิก
          </Button>
          <Button
            variant="contained"
            disabled={
              creating
              || newEmployee.fullName.trim().length < 2
              || newEmployee.email.trim().length < 5
              || newEmployee.password.length < 10
            }
            onClick={() => void createEmployee()}
          >
            {creating ? <CircularProgress size={22} color="inherit" /> : 'สร้างบัญชีพนักงาน'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
