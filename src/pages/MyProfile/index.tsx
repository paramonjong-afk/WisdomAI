import {
  Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { StandardDataTable } from '../../components/StandardDataTable'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { PersonalDocumentsPanel } from './PersonalDocumentsPanel'

type Attendance = {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  break_minutes: number
  worked_minutes: number | null
  normal_minutes: number | null
  overtime_minutes: number
  project_sites: { name: string; projects: { name: string } | null } | null
}
type PayAdjustment = {
  id: string
  effective_date: string
  adjustment_type: string
  amount: number
  description: string | null
  status: string
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
  const navigate = useNavigate()
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
  const [adjustments, setAdjustments] = useState<PayAdjustment[]>([])
  const [correctionSession, setCorrectionSession] = useState<Attendance | null>(null)
  const [correctionIn, setCorrectionIn] = useState('')
  const [correctionOut, setCorrectionOut] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const loadAttendance = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setErrorMessage('')
    const [year, month] = selectedMonth.split('-').map(Number)
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1)
    const [attendanceResult, adjustmentResult] = await Promise.all([
      supabase.from('attendance_sessions')
        .select('id,clock_in_at,clock_out_at,status,break_minutes,worked_minutes,normal_minutes,overtime_minutes,project_sites(name,projects(name))')
        .eq('profile_id', user.id)
        .neq('status', 'duplicate')
        .gte('clock_in_at', start.toISOString())
        .lt('clock_in_at', end.toISOString())
        .order('clock_in_at', { ascending: false }),
      supabase.from('employee_pay_adjustments')
        .select('id,effective_date,adjustment_type,amount,description,status')
        .eq('profile_id', user.id)
        .gte('effective_date', start.toISOString().slice(0, 10))
        .lt('effective_date', end.toISOString().slice(0, 10))
        .order('effective_date', { ascending: false }),
    ])
    if (attendanceResult.error) setErrorMessage(userError(attendanceResult.error))
    else setAttendance((attendanceResult.data ?? []) as unknown as Attendance[])
    if (!adjustmentResult.error) setAdjustments((adjustmentResult.data ?? []) as PayAdjustment[])
    setLoading(false)
  }, [selectedMonth, user])

  useEffect(() => {
    if (tab !== 1 && tab !== 2) return
    const timer = window.setTimeout(() => void loadAttendance(), 0)
    return () => window.clearTimeout(timer)
  }, [loadAttendance, tab])

  const totalHours = attendance.reduce((total, item) => {
    if (!item.clock_out_at) return total
    return total + Math.max(0, Number(item.worked_minutes ?? 0))
  }, 0) / 60
  const payProfile = profile as (typeof profile & {
    employment_type?: 'daily' | 'monthly'
    daily_rate?: number
    monthly_salary?: number
  })
  const estimatedBasePay = payProfile?.employment_type === 'monthly'
    ? Number(payProfile.monthly_salary ?? 0)
    : attendance.filter((item) => item.clock_out_at && ['normal', 'approved'].includes(item.status)).length
      * Number(payProfile?.daily_rate ?? 0)
  const positiveAdjustments = adjustments
    .filter((item) => ['allowance', 'bonus', 'reimbursement'].includes(item.adjustment_type) && item.status !== 'rejected')
    .reduce((sum, item) => sum + Number(item.amount), 0)
  const deductions = adjustments
    .filter((item) => ['wage_advance', 'cash_advance', 'deduction'].includes(item.adjustment_type) && item.status !== 'rejected')
    .reduce((sum, item) => sum + Number(item.amount), 0)

  const submitCorrection = async () => {
    if (!correctionSession || !correctionIn || !correctionOut || correctionReason.trim().length < 3) return
    setSaving(true)
    setErrorMessage('')
    try {
      await runWithMutationAttempt({
        module: 'MyProfile',
        action: 'ส่งคำขอแก้ไขเวลา',
        actorProfileId: user?.id,
        companyId: null,
        request: {
          target_session_id: correctionSession.id,
          requested_in: new Date(correctionIn).toISOString(),
          requested_out: new Date(correctionOut).toISOString(),
          request_reason: correctionReason.trim(),
        },
        operation: async () => await supabase.rpc('request_attendance_correction', {
          target_session_id: correctionSession.id,
          requested_in: new Date(correctionIn).toISOString(),
          requested_out: new Date(correctionOut).toISOString(),
          request_reason: correctionReason.trim(),
        }),
      })
      setMessage('ส่งคำขอแก้ไขเวลาให้ผู้จัดการตรวจสอบแล้ว')
      setCorrectionSession(null)
      setCorrectionIn('')
      setCorrectionOut('')
      setCorrectionReason('')
      await loadAttendance()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : userError(error))
    }
    setSaving(false)
  }

  const openCorrection = (item:Attendance) => {
    const localValue = (value:string) => {
      const date = new Date(value)
      const offset = date.getTimezoneOffset()
      return new Date(date.getTime()-offset*60_000).toISOString().slice(0,16)
    }
    setCorrectionSession(item)
    setCorrectionIn(localValue(item.clock_in_at))
    setCorrectionOut(item.clock_out_at ? localValue(item.clock_out_at) : '')
    setCorrectionReason('')
  }

  const saveProfile = async () => {
    if (!user) return
    setSaving(true)
    setMessage('')
    setErrorMessage('')
    try {
      await runWithMutationAttempt({
        module: 'MyProfile',
        action: 'อัปเดตชื่อพนักงาน',
        actorProfileId: user.id,
        companyId: null,
        request: { target_profile_id: user.id, new_full_name: fullName },
        operation: async () => await supabase.rpc('set_profile_full_name', {
          target_profile_id: user.id,
          new_full_name: fullName,
        }),
      })
      window.localStorage.setItem('wisdomai-device-owner', deviceOwnerName.trim())
      await refreshProfile()
      setMessage('บันทึกชื่อพนักงานและเจ้าของมือถือแล้ว ข้อความ LINE ครั้งต่อไปจะแสดงข้อมูลนี้')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : userError(error))
    }
    setSaving(false)
  }

  const changePassword = async () => {
    setMessage('')
    setErrorMessage('')
    if (newPassword.length < 10) {
      setErrorMessage('รหัสผ่านใหม่ต้องมีอย่างน้อย 10 ตัวอักษร')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน')
      return
    }
    setChangingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setErrorMessage(userError(error))
    else {
      setNewPassword('')
      setConfirmPassword('')
      setMessage('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว')
    }
    setChangingPassword(false)
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="ข้อมูลส่วนตัว" description="ข้อมูลพนักงานและประวัติการลงเวลาของคุณ" />
      <Button
        type="button"
        variant="contained"
        size="large"
        onClick={() => navigate('/time-tracking')}
        sx={{ display: { xs: 'inline-flex', md: 'none' }, minHeight: 48 }}
      >
        ไปหน้าลงเวลา
      </Button>
      <Paper variant="outlined">
        <Tabs value={tab} onChange={(_event, nextTab: number) => setTab(nextTab)} variant="fullWidth">
          <Tab label="ข้อมูลส่วนตัว" />
          <Tab label="ประวัติลงเวลา" />
          <Tab label="รายได้และการเบิก" />
          <Tab label="เอกสารส่วนตัว" />
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

      {tab === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack spacing={2}>
            <Typography variant="h6">เปลี่ยนรหัสผ่าน</Typography>
            <Alert severity="info">หากได้รับรหัสผ่านชั่วคราวจากผู้ดูแล กรุณาเปลี่ยนรหัสผ่านทันที</Alert>
            <TextField
              type="password"
              label="รหัสผ่านใหม่"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              helperText="อย่างน้อย 10 ตัวอักษร"
            />
            <TextField
              type="password"
              label="ยืนยันรหัสผ่านใหม่"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
            <Button
              variant="outlined"
              size="large"
              disabled={changingPassword || newPassword.length < 10 || confirmPassword.length < 10}
              onClick={() => void changePassword()}
            >
              {changingPassword ? <CircularProgress size={24} color="inherit" /> : 'เปลี่ยนรหัสผ่าน'}
            </Button>
          </Stack>
        </Paper>
      )}

      {tab === 1 && (
        <Stack spacing={2}>
          <Button variant="contained" size="large" onClick={() => navigate('/time-tracking')}>
            กลับไปหน้าลงเวลา
          </Button>
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
          ) : (
            <>
            <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
              {attendance.map((item) => {
                const duration = item.clock_out_at
                  ? Number(item.worked_minutes ?? 0) / 60
                  : null
                const status = statusDetails[item.status] ?? { label: item.status, color: 'default' as const }
                return (
                  <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography sx={{ fontWeight: 800 }}>
                          {new Date(item.clock_in_at).toLocaleDateString('th-TH', { dateStyle: 'medium' })}
                        </Typography>
                        <Chip size="small" label={!item.clock_out_at ? 'ขาดเวลาออก' : status.label}
                          color={!item.clock_out_at ? 'error' : status.color} />
                      </Stack>
                      <Typography>{item.project_sites?.name ?? 'ไม่ระบุไซต์'}</Typography>
                      <Typography color="text.secondary">
                        เข้า {new Date(item.clock_in_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                        {' · '}ออก {item.clock_out_at
                          ? new Date(item.clock_out_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                          : '--:--'}
                      </Typography>
                      <Typography sx={{ fontWeight: 700 }}>
                        รวม {duration === null ? 'ยังไม่สรุป' : `${duration.toFixed(1)} ชั่วโมง`}
                      </Typography>
                      {(!item.clock_out_at || ['needs_review', 'pending', 'rejected'].includes(item.status)) && (
                        <Button variant="outlined" onClick={() => openCorrection(item)}>
                          แจ้งขอแก้ไข
                        </Button>
                      )}
                    </Stack>
                  </Paper>
                )
              })}
              {attendance.length === 0 && <Alert severity="info">ไม่พบข้อมูลลงเวลาในเดือนนี้</Alert>}
            </Stack>
            <Stack sx={{ display: { xs: 'none', md: 'block' } }}>
              <StandardDataTable
              rows={attendance}
              getRowId={(item) => item.id}
              getSearchText={(item) => [
                item.project_sites?.projects?.name,
                item.project_sites?.name,
                statusDetails[item.status]?.label,
              ].filter(Boolean).join(' ')}
              searchLabel="ค้นหาโครงการ ไซต์ หรือสถานะ"
              emptyText="ไม่พบข้อมูลลงเวลาในเดือนนี้"
              exportFileName="wisdomai-my-attendance"
              columns={[
                {
                  id: 'project',
                  label: 'โครงการ',
                  minWidth: 180,
                  render: (item) => item.project_sites?.projects?.name ?? '-',
                  exportValue: (item) => item.project_sites?.projects?.name,
                },
                {
                  id: 'site',
                  label: 'ไซต์',
                  minWidth: 160,
                  render: (item) => item.project_sites?.name ?? '-',
                  exportValue: (item) => item.project_sites?.name,
                },
                {
                  id: 'clock-in',
                  label: 'เวลาเข้า',
                  minWidth: 180,
                  render: (item) => new Date(item.clock_in_at).toLocaleString('th-TH'),
                  exportValue: (item) => new Date(item.clock_in_at).toLocaleString('th-TH'),
                },
                {
                  id: 'clock-out',
                  label: 'เวลาออก',
                  minWidth: 180,
                  render: (item) => item.clock_out_at ? new Date(item.clock_out_at).toLocaleString('th-TH') : 'ยังไม่ได้ลงเวลาออก',
                  exportValue: (item) => item.clock_out_at ? new Date(item.clock_out_at).toLocaleString('th-TH') : '',
                },
                {
                  id: 'duration',
                  label: 'ชั่วโมงทำงาน',
                  align: 'right',
                  render: (item) => item.clock_out_at
                    ? (Number(item.worked_minutes ?? 0) / 60).toFixed(1)
                    : '-',
                  exportValue: (item) => item.clock_out_at
                    ? (Number(item.worked_minutes ?? 0) / 60).toFixed(1)
                    : '',
                },
                {
                  id: 'status',
                  label: 'สถานะ',
                  render: (item) => {
                    const status = statusDetails[item.status] ?? { label: item.status, color: 'default' as const }
                    return <Chip size="small" label={status.label} color={status.color} />
                  },
                  exportValue: (item) => statusDetails[item.status]?.label ?? item.status,
                },
              ]}
            />
            </Stack>
            </>
          )}
        </Stack>
      )}

      {tab === 2 && (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <TextField select fullWidth label="เลือกเดือน" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <MenuItem value={currentMonth}>{monthLabel(currentMonth)} (เดือนปัจจุบัน)</MenuItem>
              <MenuItem value={previousMonth}>{monthLabel(previousMonth)} (เดือนก่อน)</MenuItem>
            </TextField>
          </Paper>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {[
              ['ค่าจ้างประมาณการ', estimatedBasePay],
              ['เงินเพิ่ม/คืนค่าใช้จ่าย', positiveAdjustments],
              ['เบิก/รายการหัก', deductions],
              ['ยอดสุทธิประมาณการ', estimatedBasePay + positiveAdjustments - deductions],
            ].map(([label, amount]) => (
              <Paper key={String(label)} variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Typography color="text.secondary">{label}</Typography>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>
                  ฿{Number(amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </Typography>
              </Paper>
            ))}
          </Stack>
          <Alert severity="info">
            ยอดนี้เป็นประมาณการจากเวลาที่สมบูรณ์และรายการที่อนุมัติ ไม่ถือว่า “จ่ายแล้ว”
            จนกว่าฝ่ายบัญชีจะยืนยันการจ่าย
          </Alert>
          <Stack spacing={1.5}>
            {adjustments.map((item) => (
              <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Stack>
                    <Typography sx={{ fontWeight: 800 }}>{item.description || item.adjustment_type}</Typography>
                    <Typography color="text.secondary">
                      {new Date(item.effective_date).toLocaleDateString('th-TH')} · {item.status}
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontWeight: 800 }}>฿{Number(item.amount).toLocaleString('th-TH')}</Typography>
                </Stack>
              </Paper>
            ))}
            {!loading && adjustments.length === 0 && <Alert severity="info">ยังไม่มีรายการเบิกหรือปรับค่าจ้างในเดือนนี้</Alert>}
          </Stack>
        </Stack>
      )}

      {tab === 3 && user && <PersonalDocumentsPanel profileId={user.id} />}

      <Dialog open={Boolean(correctionSession)} onClose={() => !saving && setCorrectionSession(null)} fullWidth maxWidth="sm">
        <DialogTitle>แจ้งขอแก้ไขเวลา</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              type="datetime-local"
              label="เวลาเข้าที่ถูกต้อง"
              value={correctionIn}
              onChange={(event) => setCorrectionIn(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="datetime-local"
              label="เวลาออกที่ถูกต้อง"
              value={correctionOut}
              onChange={(event) => setCorrectionOut(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              multiline minRows={3} label="เหตุผล"
              value={correctionReason}
              onChange={(event) => setCorrectionReason(event.target.value)}
              helperText="ผู้จัดการจะเห็นเหตุผลนี้ก่อนอนุมัติ"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={saving} onClick={() => setCorrectionSession(null)}>ยกเลิก</Button>
          <Button variant="contained" disabled={saving || !correctionIn || !correctionOut || correctionReason.trim().length < 3}
            onClick={() => void submitCorrection()}>
            ส่งคำขอ
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

