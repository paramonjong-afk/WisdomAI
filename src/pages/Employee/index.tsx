import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Chip, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Employee = {
  id: string
  full_name: string | null
  email: string | null
  role: 'admin' | 'manager' | 'employee'
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
  const { user, profile, refreshProfile } = useAuth()
  const canManage = profile?.role === 'admin' || profile?.role === 'manager'
  const canCreate = profile?.role === 'admin'
  const [employees, setEmployees] = useState<Employee[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newEmployee, setNewEmployee] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'employee' as 'employee' | 'manager',
  })
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
    const { data, error } = await query
    if (error) {
      setErrorMessage(error.message)
    } else {
      const rows = (data ?? []) as Employee[]
      setEmployees(rows)
      setNames(Object.fromEntries(rows.map((employee) => [employee.id, employee.full_name ?? ''])))
    }
    setLoading(false)
  }, [canManage, user])

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
    const { data, error } = await supabase.functions.invoke('create-employee', {
      body: newEmployee,
    })
    if (error || data?.error) {
      setErrorMessage(data?.error || error?.message || 'ไม่สามารถเพิ่มพนักงานได้')
    } else {
      setMessage(`สร้างบัญชี ${newEmployee.fullName} สำเร็จ กรุณาส่งอีเมลและรหัสผ่านชั่วคราวให้พนักงานด้วยช่องทางส่วนตัว`)
      setCreateOpen(false)
      setNewEmployee({ fullName: '', email: '', password: '', role: 'employee' })
      await loadEmployees()
    }
    setCreating(false)
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
    const { data, error } = await query
    if (error) setErrorMessage(error.message)
    else setAttendanceLogs((data ?? []) as unknown as AttendanceLog[])
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

  const reviewAttendance = async (attendanceId: string, status: 'approved' | 'rejected') => {
    if (!user) return
    setReviewingId(attendanceId)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase
      .from('attendance_sessions')
      .update({ status, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq('id', attendanceId)
    if (error) setErrorMessage(error.message)
    else {
      setMessage(status === 'approved' ? 'อนุมัติรายการลงเวลาแล้ว' : 'ปฏิเสธรายการลงเวลาแล้ว')
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
        action={canCreate && tab === 0 ? <Button variant="contained" onClick={() => setCreateOpen(true)}>เพิ่มพนักงาน</Button> : undefined}
      />

      {message && <Alert severity="success">{message}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

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
          {employees.map((employee) => (
            <Paper key={employee.id} variant="outlined" sx={{ p: 2.5 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
                <Stack sx={{ minWidth: { md: 260 } }}>
                  <Typography sx={{ fontWeight: 700 }}>{employee.email ?? 'ไม่มีอีเมล'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    สิทธิ์: {employee.role}
                  </Typography>
                </Stack>
                <TextField
                  fullWidth
                  label="ชื่อพนักงานที่แจ้งใน LINE"
                  value={names[employee.id] ?? ''}
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                  onChange={(event) => setNames((current) => ({
                    ...current,
                    [employee.id]: event.target.value,
                  }))}
                />
                <Button
                  variant="contained"
                  disabled={savingId === employee.id || (names[employee.id]?.trim().length ?? 0) < 2}
                  onClick={() => void saveName(employee)}
                >
                  {savingId === employee.id ? <CircularProgress size={22} color="inherit" /> : 'บันทึกชื่อ'}
                </Button>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ))}

      {tab === 1 && canManage && (
        <Stack spacing={2}>
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
              </TextField>
              <Button variant="outlined" onClick={() => void loadAttendanceLogs()}>รีเฟรช</Button>
            </Stack>
          </Paper>

          {loadingLogs ? (
            <Stack sx={{ alignItems: 'center', py: 6 }}><CircularProgress /></Stack>
          ) : attendanceLogs.length === 0 ? (
            <Alert severity="info">ไม่พบรายการลงเวลาตามตัวกรองที่เลือก</Alert>
          ) : attendanceLogs.map((log) => {
            const employeeName = log.profiles?.full_name || log.profiles?.email || 'ไม่ทราบชื่อ'
            const isReview = log.status === 'needs_review' || log.status === 'pending'
            return (
              <Paper key={log.id} variant="outlined" sx={{ p: 2.5 }}>
                <Stack spacing={1.25}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
                    <Stack>
                      <Typography variant="h6">{employeeName}</Typography>
                      <Typography color="text.secondary">
                        {log.project_sites?.projects?.name ?? '-'} · {log.project_sites?.name ?? '-'}
                      </Typography>
                    </Stack>
                    <Chip
                      label={log.status === 'needs_review' ? 'รอตรวจสอบ/อยู่นอกไซต์' : log.status}
                      color={isReview ? 'warning' : log.status === 'approved' || log.status === 'normal' ? 'success' : log.status === 'rejected' ? 'error' : 'default'}
                    />
                  </Stack>
                  <Typography>เข้า: {new Date(log.clock_in_at).toLocaleString('th-TH')}</Typography>
                  <Typography>ออก: {log.clock_out_at ? new Date(log.clock_out_at).toLocaleString('th-TH') : 'ยังไม่ได้ลงเวลาออก'}</Typography>
                  <Typography>
                    ระยะจากไซต์: เข้า {log.clock_in_distance_meters === null ? '-' : `${Math.round(log.clock_in_distance_meters)} เมตร`}
                    {' · '}ออก {log.clock_out_distance_meters === null ? '-' : `${Math.round(log.clock_out_distance_meters)} เมตร`}
                  </Typography>
                  <Typography>
                    ความแม่นยำ GPS: เข้า ±{log.clock_in_accuracy_meters === null ? '-' : `${Math.round(log.clock_in_accuracy_meters)} เมตร`}
                    {' · '}ออก ±{log.clock_out_accuracy_meters === null ? '-' : `${Math.round(log.clock_out_accuracy_meters)} เมตร`}
                  </Typography>
                  <Typography color="text.secondary">
                    มือถือของ: {log.clock_in_device_info?.ownerName || 'ยังไม่ระบุ'} · {log.clock_in_device_info?.label || 'ไม่ทราบอุปกรณ์'}
                  </Typography>
                  {isReview && (
                    <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
                      <Button
                        variant="contained"
                        color="success"
                        disabled={reviewingId === log.id}
                        onClick={() => void reviewAttendance(log.id, 'approved')}
                      >
                        อนุมัติ
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        disabled={reviewingId === log.id}
                        onClick={() => void reviewAttendance(log.id, 'rejected')}
                      >
                        ไม่อนุมัติ
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            )
          })}
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

      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>เพิ่มพนักงานใหม่</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              ระบบจะยืนยันอีเมลให้พร้อมใช้งานทันที กรุณาส่งรหัสผ่านชั่วคราวให้พนักงานเป็นการส่วนตัว
            </Alert>
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
          <Button disabled={creating} onClick={() => setCreateOpen(false)}>ยกเลิก</Button>
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
