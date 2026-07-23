import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Chip, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
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
        profiles(full_name,email),
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
