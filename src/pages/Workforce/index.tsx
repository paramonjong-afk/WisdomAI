import {
  Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Stack, Tab, Tabs,
  TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type LeaveType = { id: string; code: string; name_th: string }
type LeaveRequest = {
  id: string; profile_id: string; starts_at: string; ends_at: string; requested_minutes: number
  reason: string; status: string; leave_types: { name_th: string } | null
  profiles?: { full_name: string | null; email: string | null } | null
}
type Overtime = {
  id: string; profile_id: string; starts_at: string; ends_at: string; reason: string; status: string
  profiles?: { full_name: string | null; email: string | null } | null
}
type DocumentRequest = {
  id: string; profile_id: string; document_type: string; request_channel: string
  delivery_channel: string; status: string; created_at: string; output_storage_path?: string | null
  profiles?: { full_name: string | null; email: string | null } | null
}
type Payroll = {
  id: string; profile_id: string; normal_minutes: number; overtime_minutes: number; base_pay: number
  overtime_pay: number; additions: number; deductions: number; reimbursements: number
  net_pay: number; status: string; payment_reference?: string | null
  pay_periods: { name: string; pay_date: string } | null
  profiles?: { full_name: string | null; email: string | null } | null
  employee_payslips?: { document_number: string; status: string }[] | null
}
type Employee = { id: string; full_name: string | null; email: string | null }
type PayPeriod = { id: string; name: string; starts_on: string; ends_on: string; pay_date: string; status: string }
type LeaveBalance = {
  profile_id: string; balance_year: number; granted_minutes: number; used_minutes: number; pending_minutes: number
  leave_types: { name_th: string } | null
}
type AttendanceRow = {
  id: string; profile_id: string; clock_in_at: string; clock_out_at: string | null
  status: string; late_minutes: number; early_leave_minutes: number; worked_minutes: number | null
  project_sites: { id: string; name: string; projects: { name: string } | null } | null
  profiles?: { full_name: string | null; email: string | null } | null
}
type Site = { id: string; name: string; projects: { name: string } | null }

const dateTime = (value: string) => new Date(value).toLocaleString('th-TH')
const employeeName = (row: { profiles?: { full_name: string | null; email: string | null } | null }) =>
  row.profiles?.full_name || row.profiles?.email || 'ไม่ทราบชื่อ'

export function WorkforcePage() {
  usePageTitle('งานบุคคล')
  const { user, profile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([])
  const [overtime, setOvertime] = useState<Overtime[]>([])
  const [documentRequests, setDocumentRequests] = useState<DocumentRequest[]>([])
  const [payrolls, setPayrolls] = useState<Payroll[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [periods, setPeriods] = useState<PayPeriod[]>([])
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([])
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [reportSiteId, setReportSiteId] = useState('all')
  const [paymentReferences, setPaymentReferences] = useState<Record<string, string>>({})
  const [documentPaths, setDocumentPaths] = useState<Record<string, string>>({})
  const [leaveForm, setLeaveForm] = useState({ leaveTypeId: '', startsAt: '', endsAt: '', reason: '' })
  const [leaveMode, setLeaveMode] = useState<'full'|'morning'|'afternoon'|'custom'>('full')
  const [leaveDate, setLeaveDate] = useState('')
  const [otForm, setOtForm] = useState({ profileId: '', startsAt: '', endsAt: '', reason: '' })
  const [documentForm, setDocumentForm] = useState({ documentType: 'payslip', deliveryChannel: 'web' })
  const [periodForm, setPeriodForm] = useState({ name: '', startsOn: '', endsOn: '', payDate: '' })

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const own = canManage ? undefined : user.id
    const leaveQuery = supabase.from('employee_leave_requests')
      .select('id,profile_id,starts_at,ends_at,requested_minutes,reason,status,leave_types(name_th),profiles:profiles!employee_leave_requests_profile_id_fkey(full_name,email)')
      .order('created_at', { ascending: false }).limit(200)
    const otQuery = supabase.from('employee_overtime_assignments')
      .select('id,profile_id,starts_at,ends_at,reason,status,profiles:profiles!employee_overtime_assignments_profile_id_fkey(full_name,email)')
      .order('created_at', { ascending: false }).limit(200)
    const documentQuery = supabase.from('employee_document_requests')
      .select('id,profile_id,document_type,request_channel,delivery_channel,status,created_at,output_storage_path,profiles:profiles!employee_document_requests_profile_id_fkey(full_name,email)')
      .order('created_at', { ascending: false }).limit(200)
    const payrollQuery = supabase.from('employee_payrolls')
      .select('id,profile_id,normal_minutes,overtime_minutes,base_pay,overtime_pay,additions,deductions,reimbursements,net_pay,status,payment_reference,pay_periods(name,pay_date),profiles:profiles!employee_payrolls_profile_id_fkey(full_name,email),employee_payslips(document_number,status)')
      .order('created_at', { ascending: false })
    if (own) {
      leaveQuery.eq('profile_id', own)
      otQuery.eq('profile_id', own)
      documentQuery.eq('profile_id', own)
      payrollQuery.eq('profile_id', own)
    }
    const [leaveTypesResult, leaveResult, otResult, documentResult, payrollResult, balanceResult] = await Promise.all([
      supabase.from('leave_types').select('id,code,name_th').eq('active', true).order('name_th'),
      leaveQuery, otQuery, documentQuery,
      payrollQuery,
      supabase.from('employee_leave_balances')
        .select('profile_id,balance_year,granted_minutes,used_minutes,pending_minutes,leave_types(name_th)')
        .eq('profile_id', user.id).eq('balance_year', new Date().getFullYear()),
    ])
    const [employeeResult, periodResult, attendanceResult, siteResult] = canManage
      ? await Promise.all([
        supabase.from('profiles').select('id,full_name,email').order('full_name'),
        supabase.from('pay_periods').select('id,name,starts_on,ends_on,pay_date,status').order('starts_on', { ascending: false }),
        supabase.from('attendance_sessions')
          .select('id,profile_id,clock_in_at,clock_out_at,status,late_minutes,early_leave_minutes,worked_minutes,project_sites(id,name,projects(name)),profiles!attendance_sessions_profile_id_fkey(full_name,email)')
          .gte('clock_in_at', `${reportMonth}-01T00:00:00+07:00`)
          .lt('clock_in_at', new Date(Number(reportMonth.slice(0,4)), Number(reportMonth.slice(5,7)), 1).toISOString())
          .neq('status','duplicate')
          .order('clock_in_at',{ascending:false}),
        supabase.from('project_sites').select('id,name,projects(name)').eq('active',true).order('name'),
      ])
      : [
          { data: [] as Employee[], error: null }, { data: [] as PayPeriod[], error: null },
          { data: [] as AttendanceRow[], error: null }, { data: [] as Site[], error: null },
        ]
    const allResults = [leaveTypesResult, leaveResult, otResult, documentResult, payrollResult, balanceResult, employeeResult, periodResult, attendanceResult, siteResult]
    const firstError = allResults.find((result) => result.error)?.error
    if (firstError) setErrorMessage(firstError.message)
    setLeaveTypes((leaveTypesResult.data ?? []) as LeaveType[])
    setLeaveRequests((leaveResult.data ?? []) as unknown as LeaveRequest[])
    setOvertime((otResult.data ?? []) as unknown as Overtime[])
    setDocumentRequests((documentResult.data ?? []) as unknown as DocumentRequest[])
    setPayrolls((payrollResult.data ?? []) as unknown as Payroll[])
    setLeaveBalances((balanceResult.data ?? []) as unknown as LeaveBalance[])
    setEmployees((employeeResult.data ?? []) as unknown as Employee[])
    setPeriods((periodResult.data ?? []) as unknown as PayPeriod[])
    setAttendanceRows((attendanceResult.data ?? []) as unknown as AttendanceRow[])
    setSites((siteResult.data ?? []) as unknown as Site[])
    setLoading(false)
  }, [canManage, reportMonth, user])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [loadData])

  const run = async (operation: () => PromiseLike<{ error: { message: string } | null }>, success: string) => {
    setBusy(true); setMessage(''); setErrorMessage('')
    const result = await operation()
    if (result.error) setErrorMessage(result.error.message)
    else { setMessage(success); await loadData() }
    setBusy(false)
  }

  const submitLeave = async () => {
    if (!user) return
    const fixedTimes = {
      full: ['08:00','17:00',480],
      morning: ['08:00','12:00',240],
      afternoon: ['13:00','17:00',240],
    } as const
    const fixed = leaveMode === 'custom' ? null : fixedTimes[leaveMode]
    const start = new Date(fixed ? `${leaveDate}T${fixed[0]}` : leaveForm.startsAt)
    const end = new Date(fixed ? `${leaveDate}T${fixed[1]}` : leaveForm.endsAt)
    const minutes = fixed ? fixed[2] : Math.floor((end.getTime() - start.getTime()) / 60_000)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || minutes <= 0) {
      setErrorMessage('กรุณาตรวจสอบวันและช่วงเวลาการลา')
      return
    }
    await run(() => supabase.from('employee_leave_requests').insert({
      profile_id: user.id, leave_type_id: leaveForm.leaveTypeId,
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      requested_minutes: minutes, reason: leaveForm.reason.trim(),
      status: start.getTime() - Date.now() < 24 * 3_600_000 ? 'late_notice' : 'pending',
      submitted_at: new Date().toISOString(),
    }), 'ส่งคำขอลาเรียบร้อยแล้ว ผู้จัดการจะได้รับรายการเพื่ออนุมัติ')
  }

  const filteredAttendance = attendanceRows.filter((row) =>
    reportSiteId === 'all' || row.project_sites?.id === reportSiteId)
  const todayKey = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date())
  const todayAttendance = filteredAttendance.filter((row) =>
    new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(row.clock_in_at)) === todayKey)
  const todayLeave = leaveRequests.filter((row) =>
    ['approved','used'].includes(row.status)
    && new Date(row.starts_at) < new Date(`${todayKey}T23:59:59+07:00`)
    && new Date(row.ends_at) > new Date(`${todayKey}T00:00:00+07:00`))
  const reportDays = Array.from(
    { length: new Date(Number(reportMonth.slice(0,4)), Number(reportMonth.slice(5,7)), 0).getDate() },
    (_item,index) => `${reportMonth}-${String(index+1).padStart(2,'0')}`,
  )

  const submitDocument = async () => {
    if (!user) return
    await run(() => supabase.from('employee_document_requests').insert({
      profile_id: user.id, document_type: documentForm.documentType,
      delivery_channel: documentForm.deliveryChannel, request_channel: 'web', status: 'pending',
    }), 'ส่งคำขอเอกสารแล้ว ระบบจะส่งหลังได้รับอนุมัติ')
  }

  const assignOvertime = async () => {
    await run(() => supabase.from('employee_overtime_assignments').insert({
      profile_id: otForm.profileId, starts_at: new Date(otForm.startsAt).toISOString(),
      ends_at: new Date(otForm.endsAt).toISOString(), reason: otForm.reason.trim(),
      status: 'assigned', assigned_by: user?.id,
    }), 'มอบหมาย OT แล้ว')
  }

  const createPeriod = async () => {
    await run(() => supabase.from('pay_periods').insert({
      name: periodForm.name, starts_on: periodForm.startsOn,
      ends_on: periodForm.endsOn, pay_date: periodForm.payDate,
    }), 'สร้างรอบค่าจ้างแล้ว')
  }

  const rpcReview = async (rpc: string, args: Record<string, unknown>, success: string) => {
    await run(() => supabase.rpc(rpc, args), success)
  }

  const payrollAction = async (payroll: Payroll, action: 'approve' | 'send_to_payment' | 'mark_paid') => {
    await rpcReview('transition_employee_payroll', {
      target_payroll_id: payroll.id,
      target_action: action,
      target_payment_reference: action === 'mark_paid' ? paymentReferences[payroll.id]?.trim() || null : null,
    }, action === 'mark_paid' ? 'ยืนยันการจ่ายและออก Payslip แล้ว' : 'ปรับสถานะค่าจ้างแล้ว')
  }

  const documentAction = async (request: DocumentRequest, action: 'generate' | 'ready' | 'deliver' | 'reject') => {
    await rpcReview('transition_document_request', {
      target_request_id: request.id,
      target_action: action,
      target_output_path: documentPaths[request.id]?.trim() || request.output_storage_path || null,
      target_note: action === 'reject' ? 'ไม่ผ่านการอนุมัติ' : null,
    }, 'ปรับสถานะคำขอเอกสารแล้ว')
  }

  if (loading) return <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack>

  return <Stack spacing={3}>
    <PageHeader title="งานบุคคล" description="ลา · OT · ค่าจ้าง · Payslip · คำขอเอกสาร" />
    {message && <Alert severity="success">{message}</Alert>}
    {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
    <Paper variant="outlined">
      <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} variant="scrollable" scrollButtons="auto">
        <Tab label="การลา" /><Tab label="OT" /><Tab label="ค่าจ้าง" /><Tab label="ขอเอกสาร" />
        {canManage && <Tab label="รอบค่าจ้าง" />}
      </Tabs>
    </Paper>

    {tab === 0 && <Stack spacing={2}>
      {canManage && <>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction={{ xs:'column',md:'row' }} spacing={2} sx={{ mb:2 }}>
            <TextField type="month" label="เดือนรายงาน" value={reportMonth}
              onChange={(event) => setReportMonth(event.target.value)}
              slotProps={{ inputLabel:{ shrink:true } }} />
            <TextField select label="ไซต์งาน" value={reportSiteId}
              onChange={(event) => setReportSiteId(event.target.value)} sx={{ minWidth:240 }}>
              <MenuItem value="all">ทุกไซต์งาน</MenuItem>
              {sites.map((site) => <MenuItem key={site.id} value={site.id}>
                {site.projects?.name ? `${site.projects.name} · ` : ''}{site.name}
              </MenuItem>)}
            </TextField>
          </Stack>
          <Box sx={{ display:'grid',gridTemplateColumns:{xs:'repeat(2,1fr)',md:'repeat(4,1fr)'},gap:1.5 }}>
            {[
              ['มาแล้ววันนี้',todayAttendance.length,'success.main'],
              ['มาสาย',todayAttendance.filter((row)=>row.late_minutes>0).length,'warning.main'],
              ['ลาวันนี้',todayLeave.length,'info.main'],
              ['ขาด/ยังไม่ลงเวลา',Math.max(0,employees.length-new Set(todayAttendance.map((row)=>row.profile_id)).size-new Set(todayLeave.map((row)=>row.profile_id)).size),'error.main'],
              ['ยังไม่ลงเวลาออก',todayAttendance.filter((row)=>!row.clock_out_at).length,'error.main'],
              ['รอตรวจเวลา',todayAttendance.filter((row)=>['pending','needs_review'].includes(row.status)).length,'warning.main'],
              ['รออนุมัติลา',leaveRequests.filter((row)=>['pending','late_notice','needs_evidence'].includes(row.status)).length,'warning.main'],
              ['ชั่วโมงทำงาน',Math.round(filteredAttendance.reduce((sum,row)=>sum+Number(row.worked_minutes??0),0)/60),'primary.main'],
              ['พนักงานทั้งหมด',employees.length,'text.primary'],
            ].map(([label,value,color]) => <Paper key={String(label)} variant="outlined" sx={{p:1.5}}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="h5" sx={{fontWeight:800,color:String(color)}}>{value}</Typography>
            </Paper>)}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p:2 }}>
          <Typography variant="h6">ปฏิทิน ขาด · ลา · มาสาย</Typography>
          <Typography variant="body2" color="text.secondary" sx={{mb:1.5}}>
            กดดูรายละเอียดจากรายการด้านล่าง · เขียวปกติ · เหลืองสาย/ออกก่อน · ฟ้าลา · แดงรอตรวจ
          </Typography>
          <Box sx={{display:'grid',gridTemplateColumns:'repeat(7,minmax(38px,1fr))',gap:0.75}}>
            {['จ','อ','พ','พฤ','ศ','ส','อา'].map((day)=><Typography key={day} align="center" variant="caption" sx={{fontWeight:800}}>{day}</Typography>)}
            {Array.from({length:(new Date(`${reportMonth}-01T12:00:00+07:00`).getDay()+6)%7},(_v,i)=><Box key={`empty-${i}`} />)}
            {reportDays.map((day) => {
              const dailyRows=filteredAttendance.filter((row)=>
                new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date(row.clock_in_at))===day)
              const dailyLeave=leaveRequests.filter((row)=>['approved','used'].includes(row.status)
                && new Date(row.starts_at)<new Date(`${day}T23:59:59+07:00`)
                && new Date(row.ends_at)>new Date(`${day}T00:00:00+07:00`))
              const abnormal=dailyRows.some((row)=>row.late_minutes>0||row.early_leave_minutes>0||['pending','needs_review'].includes(row.status))
              return <Paper key={day} variant="outlined" sx={{
                p:0.75,minHeight:70,borderColor:dailyLeave.length?'info.main':abnormal?'warning.main':dailyRows.length?'success.main':'divider',
                bgcolor:dailyLeave.length?'info.50':'background.paper',
              }}>
                <Typography sx={{fontWeight:800}}>{Number(day.slice(-2))}</Typography>
                <Typography variant="caption" sx={{display:'block'}}>มา {dailyRows.length}</Typography>
                {dailyLeave.length>0&&<Typography variant="caption" color="info.main">ลา {dailyLeave.length}</Typography>}
              </Paper>
            })}
          </Box>
        </Paper>

        <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',md:'repeat(2,1fr)'},gap:2}}>
          {sites.filter((site)=>reportSiteId==='all'||site.id===reportSiteId).map((site)=>{
            const rows=attendanceRows.filter((row)=>row.project_sites?.id===site.id)
            return <Paper key={site.id} variant="outlined" sx={{p:2}}>
              <Typography sx={{fontWeight:800}}>{site.projects?.name ? `${site.projects.name} · ` : ''}{site.name}</Typography>
              <Typography color="text.secondary">
                รายการ {rows.length} · สาย {rows.filter((row)=>row.late_minutes>0).length}
                {' · '}รอตรวจ {rows.filter((row)=>['pending','needs_review'].includes(row.status)).length}
                {' · '}ทำงาน {(rows.reduce((sum,row)=>sum+Number(row.worked_minutes??0),0)/60).toFixed(1)} ชม.
              </Typography>
            </Paper>
          })}
        </Box>
      </>}

      {leaveBalances.length > 0 && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        {leaveBalances.map((balance) => <Paper key={`${balance.profile_id}-${balance.leave_types?.name_th}`} variant="outlined" sx={{ p: 2, flex: 1 }}>
          <Typography sx={{ fontWeight: 800 }}>{balance.leave_types?.name_th ?? 'วันลา'}</Typography>
          <Typography color="text.secondary">
            คงเหลือ {Math.max(0, balance.granted_minutes - balance.used_minutes - balance.pending_minutes) / 480} วัน
            {' · '}ใช้แล้ว {balance.used_minutes / 480} วัน
            {' · '}รออนุมัติ {balance.pending_minutes / 480} วัน
          </Typography>
        </Paper>)}
      </Stack>}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">แจ้งลา/หยุดงาน</Typography>
          <TextField select label="ประเภทการลา" value={leaveForm.leaveTypeId}
            onChange={(event) => setLeaveForm({ ...leaveForm, leaveTypeId: event.target.value })}>
            {leaveTypes.map((type) => <MenuItem key={type.id} value={type.id}>{type.name_th}</MenuItem>)}
          </TextField>
          <TextField select label="ช่วงเวลา" value={leaveMode}
            onChange={(event) => setLeaveMode(event.target.value as typeof leaveMode)}>
            <MenuItem value="full">เต็มวัน 08:00–17:00</MenuItem>
            <MenuItem value="morning">ครึ่งวันเช้า 08:00–12:00</MenuItem>
            <MenuItem value="afternoon">ครึ่งวันบ่าย 13:00–17:00</MenuItem>
            <MenuItem value="custom">ระบุวันและเวลาเอง</MenuItem>
          </TextField>
          {leaveMode !== 'custom' ? <TextField fullWidth type="date" label="วันที่ลา" value={leaveDate}
            onChange={(event)=>setLeaveDate(event.target.value)}
            slotProps={{inputLabel:{shrink:true}}} /> : <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth type="datetime-local" label="เริ่ม" value={leaveForm.startsAt}
              onChange={(event) => setLeaveForm({ ...leaveForm, startsAt: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="datetime-local" label="สิ้นสุด" value={leaveForm.endsAt}
              onChange={(event) => setLeaveForm({ ...leaveForm, endsAt: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>}
          <TextField multiline minRows={2} label="เหตุผล" value={leaveForm.reason}
            onChange={(event) => setLeaveForm({ ...leaveForm, reason: event.target.value })} />
          <Button variant="contained" size="large" disabled={busy || !leaveForm.leaveTypeId
            || (leaveMode === 'custom' ? !leaveForm.startsAt || !leaveForm.endsAt : !leaveDate)
            || leaveForm.reason.trim().length < 3}
            onClick={() => void submitLeave()}>ส่งคำขอลา</Button>
        </Stack>
      </Paper>
      {!canManage && <Stack sx={{display:{xs:'flex',md:'none'}}} spacing={1.5}>
        <Typography variant="h6">คำขอลาล่าสุด</Typography>
        {leaveRequests.map((row)=><Paper key={row.id} variant="outlined" sx={{p:2}}>
          <Stack direction="row" sx={{justifyContent:'space-between'}} spacing={1}>
            <Typography sx={{fontWeight:800}}>{row.leave_types?.name_th??'การลา'}</Typography>
            <Chip size="small" label={row.status} color={row.status==='approved'?'success':row.status==='rejected'?'error':'warning'} />
          </Stack>
          <Typography color="text.secondary" sx={{mt:1}}>{dateTime(row.starts_at)} – {dateTime(row.ends_at)}</Typography>
          <Typography>{row.reason}</Typography>
          {['draft','pending','late_notice','needs_evidence'].includes(row.status)&&<Button size="small" color="error" sx={{mt:1}}
            onClick={()=>void rpcReview('cancel_leave_request',{target_request_id:row.id},'ยกเลิกคำขอลาแล้ว')}>ยกเลิกคำขอ</Button>}
        </Paper>)}
      </Stack>}
      <Box sx={{display:{xs:canManage?'block':'none',md:'block'}}}>
      <StandardDataTable rows={leaveRequests} getRowId={(row) => row.id}
        getSearchText={(row) => `${employeeName(row)} ${row.leave_types?.name_th} ${row.status}`}
        searchLabel="ค้นหาคำขอลา" emptyText="ยังไม่มีคำขอลา" exportFileName="employee-leave"
        columns={[
          { id: 'employee', label: 'พนักงาน', render: employeeName },
          { id: 'type', label: 'ประเภท', render: (row) => row.leave_types?.name_th ?? '-' },
          { id: 'period', label: 'ช่วงเวลา', minWidth: 280, render: (row) => `${dateTime(row.starts_at)} – ${dateTime(row.ends_at)}` },
          { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" label={row.status} /> },
          ...(canManage ? [{ id: 'action', label: 'อนุมัติ', render: (row: LeaveRequest) => row.status === 'pending' || row.status === 'late_notice'
            ? <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => void rpcReview('review_leave_request', { target_request_id: row.id, decision: 'approved', decision_note: null }, 'อนุมัติการลาแล้ว')}>อนุมัติ</Button>
                <Button size="small" color="error" onClick={() => void rpcReview('review_leave_request', { target_request_id: row.id, decision: 'rejected', decision_note: 'ไม่ผ่านการอนุมัติ' }, 'ปฏิเสธคำขอแล้ว')}>ปฏิเสธ</Button>
              </Stack> : '-' }] : [{
                id: 'action', label: 'จัดการ', render: (row: LeaveRequest) =>
                  ['draft','pending','late_notice','needs_evidence'].includes(row.status)
                    ? <Button size="small" color="error" onClick={() => void rpcReview(
                        'cancel_leave_request', { target_request_id: row.id }, 'ยกเลิกคำขอลาแล้ว'
                      )}>ยกเลิก</Button> : '-',
              }]),
        ]} />
      </Box>
    </Stack>}

    {tab === 1 && <Stack spacing={2}>
      {canManage && <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">กำหนด OT</Typography>
          <TextField select label="พนักงาน" value={otForm.profileId}
            onChange={(event) => setOtForm({ ...otForm, profileId: event.target.value })}>
            {employees.map((employee) => <MenuItem key={employee.id} value={employee.id}>{employee.full_name || employee.email}</MenuItem>)}
          </TextField>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth type="datetime-local" label="เริ่ม OT" value={otForm.startsAt}
              onChange={(event) => setOtForm({ ...otForm, startsAt: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="datetime-local" label="สิ้นสุด OT" value={otForm.endsAt}
              onChange={(event) => setOtForm({ ...otForm, endsAt: event.target.value })}
              slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <TextField label="งานที่มอบหมาย" value={otForm.reason}
            onChange={(event) => setOtForm({ ...otForm, reason: event.target.value })} />
          <Button variant="contained" disabled={busy || !otForm.profileId || !otForm.startsAt || !otForm.endsAt || otForm.reason.trim().length < 3}
            onClick={() => void assignOvertime()}>มอบหมาย OT</Button>
        </Stack>
      </Paper>}
      <StandardDataTable rows={overtime} getRowId={(row) => row.id}
        getSearchText={(row) => `${employeeName(row)} ${row.reason} ${row.status}`}
        searchLabel="ค้นหา OT" emptyText="ยังไม่มีรายการ OT" exportFileName="employee-overtime"
        columns={[
          { id: 'employee', label: 'พนักงาน', render: employeeName },
          { id: 'period', label: 'ช่วง OT', minWidth: 280, render: (row) => `${dateTime(row.starts_at)} – ${dateTime(row.ends_at)}` },
          { id: 'reason', label: 'งาน', render: (row) => row.reason },
          { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" label={row.status} /> },
          ...(canManage ? [{ id: 'action', label: 'ตรวจสอบ', render: (row: Overtime) => ['assigned','acknowledged','pending_approval'].includes(row.status)
            ? <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => void rpcReview('review_overtime_assignment', { target_assignment_id: row.id, decision: 'approved', decision_note: null }, 'อนุมัติ OT แล้ว')}>อนุมัติ OT</Button>
                <Button size="small" color="error" onClick={() => void rpcReview('review_overtime_assignment', { target_assignment_id: row.id, decision: 'rejected', decision_note: 'ไม่อนุมัติ OT' }, 'ปฏิเสธ OT แล้ว')}>ปฏิเสธ</Button>
              </Stack> : '-' }] : [{
                id: 'action', label: 'ตอบรับ', render: (row: Overtime) => row.status === 'assigned'
                  ? <Button size="small" onClick={() => void rpcReview(
                      'acknowledge_overtime_assignment', { target_assignment_id: row.id }, 'รับทราบงาน OT แล้ว'
                    )}>รับทราบ</Button> : '-',
              }]),
        ]} />
    </Stack>}

    {tab === 2 && <Stack spacing={2}>
      <Alert severity="info">แสดงเฉพาะรอบที่คำนวณแล้ว OT จะรวมเฉพาะช่วงที่ได้รับอนุมัติเท่านั้น</Alert>
      {payrolls.map((payroll) => <Paper key={payroll.id} variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: 'space-between', gap: 2 }}>
          <Stack>
            {canManage && <Typography sx={{ fontWeight: 800 }}>{employeeName(payroll)}</Typography>}
            <Typography variant="h6">{payroll.pay_periods?.name ?? 'รอบค่าจ้าง'}</Typography>
            <Typography color="text.secondary">ปกติ {(payroll.normal_minutes / 60).toFixed(2)} ชม. · OT {(payroll.overtime_minutes / 60).toFixed(2)} ชม.</Typography>
            <Chip size="small" label={payroll.status} sx={{ alignSelf: 'flex-start', mt: 1 }} />
            {payroll.employee_payslips?.[0] && <Typography color="text.secondary" sx={{ mt: 1 }}>
              Payslip {payroll.employee_payslips[0].document_number} · {payroll.employee_payslips[0].status}
            </Typography>}
          </Stack>
          <Stack sx={{ alignItems: { xs: 'stretch', md: 'flex-end' }, minWidth: { md: 300 } }} spacing={1}>
            <Typography variant="h4" sx={{ fontWeight: 800 }}>฿{Number(payroll.net_pay).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</Typography>
            {canManage && ['estimated','needs_review','adjusted'].includes(payroll.status) &&
              <Button variant="outlined" onClick={() => void payrollAction(payroll, 'approve')}>อนุมัติยอด</Button>}
            {canManage && payroll.status === 'approved' &&
              <Button variant="outlined" onClick={() => void payrollAction(payroll, 'send_to_payment')}>ส่งรอจ่าย</Button>}
            {canManage && ['approved','closed','pending_payment'].includes(payroll.status) && <>
              <TextField size="small" fullWidth label="เลขอ้างอิงการโอน" value={paymentReferences[payroll.id] ?? ''}
                onChange={(event) => setPaymentReferences({ ...paymentReferences, [payroll.id]: event.target.value })} />
              <Button variant="contained" disabled={!paymentReferences[payroll.id]?.trim()}
                onClick={() => void payrollAction(payroll, 'mark_paid')}>ยืนยันโอนแล้วและออก Payslip</Button>
            </>}
          </Stack>
        </Stack>
      </Paper>)}
      {payrolls.length === 0 && <Alert severity="info">ยังไม่มีรอบค่าจ้างที่คำนวณแล้ว</Alert>}
    </Stack>}

    {tab === 3 && <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">ขอเอกสาร</Typography>
          <TextField select label="ประเภทเอกสาร" value={documentForm.documentType}
            onChange={(event) => setDocumentForm({ ...documentForm, documentType: event.target.value })}>
            <MenuItem value="payslip">Payslip</MenuItem><MenuItem value="income_certificate">หนังสือรับรองรายได้</MenuItem>
            <MenuItem value="employment_certificate">หนังสือรับรองการทำงาน</MenuItem>
            <MenuItem value="attendance_summary">สรุปเวลาทำงาน</MenuItem><MenuItem value="overtime_summary">สรุป OT</MenuItem>
          </TextField>
          <TextField select label="ช่องทางรับ" value={documentForm.deliveryChannel}
            onChange={(event) => setDocumentForm({ ...documentForm, deliveryChannel: event.target.value })}>
            <MenuItem value="web">ดาวน์โหลดในระบบ</MenuItem><MenuItem value="line_private">LINE ส่วนตัว</MenuItem>
            <MenuItem value="physical">รับเอกสารกระดาษ</MenuItem>
          </TextField>
          <Button variant="contained" disabled={busy} onClick={() => void submitDocument()}>ส่งคำขอ</Button>
        </Stack>
      </Paper>
      <StandardDataTable rows={documentRequests} getRowId={(row) => row.id}
        getSearchText={(row) => `${employeeName(row)} ${row.document_type} ${row.status}`}
        searchLabel="ค้นหาคำขอเอกสาร" emptyText="ยังไม่มีคำขอเอกสาร" exportFileName="employee-document-requests"
        columns={[
          { id: 'employee', label: 'พนักงาน', render: employeeName },
          { id: 'type', label: 'เอกสาร', render: (row) => row.document_type },
          { id: 'channel', label: 'ช่องทางรับ', render: (row) => row.delivery_channel },
          { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" label={row.status} /> },
          ...(canManage ? [{ id: 'action', label: 'ดำเนินการ', minWidth: 320, render: (row: DocumentRequest) =>
            <Stack spacing={1}>
              {row.status === 'pending' && <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => void rpcReview('review_document_request', {
                  target_request_id: row.id, decision: 'approved', decision_note: null,
                }, 'อนุมัติคำขอเอกสารแล้ว')}>อนุมัติ</Button>
                <Button size="small" color="error" onClick={() => void documentAction(row, 'reject')}>ปฏิเสธ</Button>
              </Stack>}
              {['approved','generating','ready'].includes(row.status) && <>
                <TextField size="small" label="ตำแหน่งไฟล์/ลิงก์เอกสาร"
                  value={documentPaths[row.id] ?? row.output_storage_path ?? ''}
                  onChange={(event) => setDocumentPaths({ ...documentPaths, [row.id]: event.target.value })} />
                <Stack direction="row" spacing={1}>
                  {row.status === 'approved' && <Button size="small" onClick={() => void documentAction(row, 'generate')}>เริ่มจัดทำ</Button>}
                  {row.status !== 'ready' && <Button size="small" disabled={!(documentPaths[row.id] || row.output_storage_path)}
                    onClick={() => void documentAction(row, 'ready')}>พร้อมส่ง</Button>}
                  {row.status === 'ready' && <Button size="small" variant="contained"
                    onClick={() => void documentAction(row, 'deliver')}>ส่งมอบแล้ว</Button>}
                </Stack>
              </>}
            </Stack> }] : []),
        ]} />
    </Stack>}

    {tab === 4 && canManage && <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="h6">สร้างรอบค่าจ้าง</Typography>
          <TextField label="ชื่อรอบ" value={periodForm.name} onChange={(event) => setPeriodForm({ ...periodForm, name: event.target.value })} />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField fullWidth type="date" label="เริ่ม" value={periodForm.startsOn} onChange={(event) => setPeriodForm({ ...periodForm, startsOn: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="สิ้นสุด" value={periodForm.endsOn} onChange={(event) => setPeriodForm({ ...periodForm, endsOn: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField fullWidth type="date" label="วันจ่าย" value={periodForm.payDate} onChange={(event) => setPeriodForm({ ...periodForm, payDate: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
          <Button variant="contained" disabled={busy || !periodForm.name || !periodForm.startsOn || !periodForm.endsOn || !periodForm.payDate}
            onClick={() => void createPeriod()}>สร้างรอบ</Button>
        </Stack>
      </Paper>
      <StandardDataTable rows={periods} getRowId={(row) => row.id}
        getSearchText={(row) => `${row.name} ${row.status}`} searchLabel="ค้นหารอบค่าจ้าง"
        emptyText="ยังไม่มีรอบค่าจ้าง" exportFileName="pay-periods"
        columns={[
          { id: 'name', label: 'รอบ', render: (row) => row.name },
          { id: 'period', label: 'ช่วงวันที่', render: (row) => `${row.starts_on} – ${row.ends_on}` },
          { id: 'pay', label: 'วันจ่าย', render: (row) => row.pay_date },
          { id: 'status', label: 'สถานะ', render: (row) => <Chip size="small" label={row.status} /> },
          { id: 'action', label: 'คำนวณ', render: (row) => !['closed','paid','cancelled'].includes(row.status)
            ? <Button size="small" onClick={() => void rpcReview('generate_pay_period', { target_pay_period_id: row.id }, 'คำนวณรอบค่าจ้างแล้ว')}>คำนวณ</Button> : '-' },
        ]} />
    </Stack>}
  </Stack>
}
