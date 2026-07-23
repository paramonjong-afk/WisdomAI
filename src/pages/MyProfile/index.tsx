import {
  Alert, Button, Chip, CircularProgress, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

type Attendance = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  project_sites: { name: string; projects: { name: string } | null } | null
}

const monthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const monthLabel = (value: string) => {
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1))
}

const statusDetails: Record<string, { label: string; color: 'success' | 'warning' | 'default' | 'error' }> = {
  normal: { label: 'ปกติ', color: 'success' },
  approved: { label: 'อนุมัติแล้ว', color: 'success' },
  needs_review: { label: 'รอตรวจสอบ', color: 'warning' },
  pending: { label: 'รอตรวจสอบ', color: 'warning' },
  rejected: { label: 'ไม่อนุมัติ', color: 'error' },
}

export function MyProfilePage() {
  usePageTitle('ข้อมูลส่วนตัว')
  const { user, profile, refreshProfile } = useAuth()
  const currentMonth = useMemo(() => monthValue(new Date()), [])
  const previousMonth = useMemo(() => {
    const date = new Date()
    date.setMonth(date.getMonth() - 1)
    return monthValue(date)
  }, [])
  const [tab, setTab] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [deviceOwnerName, setDeviceOwnerName] = useState(
    () => window.localStorage.getItem('wisdomai-device-owner') ?? profile?.full_name ?? '',
  )
  const [attendance, setAttendance] = useState<Attendance[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const loadAttendance = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const [year, month] = selectedMonth.split('-').map(Number)
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)
    const { data, error } = await supabase
      .from('attendance_sessions')
      .select('id,clock_in_at,clock_out_at,status,project_sites(name,projects(name))')
      .eq('profile_id', user.id)
      .gte('clock_in_at', start.toISOString())
      .lt('clock_in_at', end.toISOString())
      .order('clock_in_at', { ascending: false })
    if (error) setErrorMessage(error.message)
    else setAttendance((data ?? []) as unknown as Attendance[])
    setLoading(false)
  }, [selectedMonth, user])

  useEffect(() => {
    if (tab !== 1) return
    const timer = window.setTimeout(() => void loadAttendance(), 0)
    return () => window.clearTimeout(timer)
  }, [loadAttendance, tab])

  const totalHours = attendance.reduce((total, item) => {
    if (!item.clock_out_at) return total
    return total + Math.max(0, new Date(item.clock_out_at).getTime() - new Date(item.clock_in_at).getTime())
  }, 0) / 3_600_000

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    setMessage('')
    setErrorMessage('')
    const { error } = await supabase.rpc('set_profile_full_name', {
      target_profile_id: user.id,
      new_full_name: fullName,
    })
    if (error) setErrorMessage(error.message)
    else {
      window.localStorage.setItem('wisdomai-device-owner', deviceOwnerName.trim())
      await refreshProfile()
      setMessage('บันทึกชื่อพนักงานและเจ้าของมือถือแล้ว ข้อความ LINE ครั้งต่อไปจะแสดงข้อมูลนี้')
    }
    setSaving(false)
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="ข้อมูลส่วนตัว" description="ข้อมูลพนักงานและประวัติการลงเวลาของคุณ" />
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_event, nextTab: number) => setTab(nextTab)} variant="fullWidth">
          <Tab label="ข้อมูลส่วนตัว" />
          <Tab label="ประวัติลงเวลา" />
        </Tabs>
      </Paper>

      {message && <Alert severity="success">{message}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}

      {tab === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2.5}>
            <TextField
              label="ชื่อ-นามสกุล"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              helperText="ชื่อนี้จะแสดงในระบบและข้อความแจ้งเตือน LINE"
            />
            <TextField label="อีเมล" value={user?.email ?? ''} disabled />
            <TextField label="สิทธิ์ผู้ใช้งาน" value={profile?.role ?? 'employee'} disabled />
            <TextField
              label="ชื่อเจ้าของมือถือเครื่องนี้"
              value={deviceOwnerName}
              onChange={(event) => setDeviceOwnerName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              helperText="ระบุว่าโทรศัพท์ที่ใช้ลงเวลาเป็นของใคร เช่น หัวหน้าช่างเอก หรือ มือถือประจำไซต์ A"
            />
            <Button
              variant="contained"
              size="large"
              disabled={saving || fullName.trim().length < 2 || deviceOwnerName.trim().length < 2}
              onClick={() => void saveProfile()}
            >
              {saving ? <CircularProgress size={24} color="inherit" /> : 'บันทึกข้อมูล'}
            </Button>
          </Stack>
        </Paper>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <TextField select fullWidth label="เลือกเดือน" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <MenuItem value={currentMonth}>{monthLabel(currentMonth)} (เดือนปัจจุบัน)</MenuItem>
              <MenuItem value={previousMonth}>{monthLabel(previousMonth)} (เดือนก่อน)</MenuItem>
            </TextField>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography color="text.secondary">จำนวนรายการลงเวลา</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{attendance.length}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography color="text.secondary">ชั่วโมงทำงานรวม</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{totalHours.toFixed(1)}</Typography>
            </Paper>
          </Stack>

          {loading ? (
            <Stack sx={{ alignItems: 'center', py: 5 }}><CircularProgress /></Stack>
          ) : attendance.length === 0 ? (
            <Alert severity="info">ไม่พบข้อมูลลงเวลาในเดือนนี้</Alert>
          ) : attendance.map((item) => {
            const status = statusDetails[item.status] ?? { label: item.status, color: 'default' as const }
            const duration = item.clock_out_at
              ? (new Date(item.clock_out_at).getTime() - new Date(item.clock_in_at).getTime()) / 3_600_000
              : null
            return (
              <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {item.project_sites?.projects?.name ?? '-'} · {item.project_sites?.name ?? '-'}
                    </Typography>
                    <Chip size="small" label={status.label} color={status.color} />
                  </Stack>
                  <Typography>เข้า: {new Date(item.clock_in_at).toLocaleString('th-TH')}</Typography>
                  <Typography>ออก: {item.clock_out_at ? new Date(item.clock_out_at).toLocaleString('th-TH') : 'ยังไม่ได้ลงเวลาออก'}</Typography>
                  <Typography color="text.secondary">
                    ระยะเวลาทำงาน: {duration === null ? '-' : `${duration.toFixed(1)} ชั่วโมง`}
                  </Typography>
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}
