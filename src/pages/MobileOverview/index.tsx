import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded'
import PendingActionsRoundedIcon from '@mui/icons-material/PendingActionsRounded'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Alert, Avatar, Box, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileBottomNav } from '../../components/MobileBottomNav'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

// Flow reference: docs/MOBILE_ADMIN_OVERVIEW_DASHBOARD_FLOW.md v1.0
// "ค้างลงเวลาออกเกินกำหนด" card reuses the same `status = 'needs_review'` /
// `review_category = 'missing_clock_out'` signal that attendance-clock (edge function)
// and attendance-reminders already set server-side — this page adds visibility,
// it does not duplicate or change that existing automation.

type OverdueSession = {
  id: string
  clock_in_at: string
  profiles: { full_name: string | null } | null
  project_sites: { name: string | null } | null
}

type OverviewStats = {
  clockedInToday: number
  needsReviewCount: number
  activeEmployees: number
}

const EMPTY_STATS: OverviewStats = { clockedInToday: 0, needsReviewCount: 0, activeEmployees: 0 }

function overdueDuration(clockInAt: string) {
  const hours = (Date.now() - new Date(clockInAt).getTime()) / 3_600_000
  if (hours >= 1) return `${hours.toFixed(1)} ชม.`
  return `${Math.max(1, Math.round(hours * 60))} นาที`
}

function StatCard({ icon, color, label, value }: { icon: ReactNode; color: string; label: string; value: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, textAlign: 'center' }}>
      <Avatar sx={{ bgcolor: color, width: 36, height: 36, mx: 'auto', mb: 0.75 }}>{icon}</Avatar>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
        {value.toLocaleString('th-TH')}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Paper>
  )
}

export function MobileOverviewPage() {
  usePageTitle('ภาพรวมวันนี้')
  const navigate = useNavigate()
  const { profile, currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<OverviewStats>(EMPTY_STATS)
  const [overdue, setOverdue] = useState<OverdueSession[]>([])

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false)
      return
    }
    setError('')
    try {
      const bangkokToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())
      const [
        { data: overdueRows, error: overdueError },
        { count: clockedInToday, error: clockedInError },
        { count: activeEmployees, error: employeesError },
      ] = await Promise.all([
        supabase
          .from('attendance_sessions')
          .select('id,clock_in_at,profiles(full_name),project_sites(name)')
          .eq('company_id', companyId)
          .is('clock_out_at', null)
          .eq('status', 'needs_review')
          .order('clock_in_at', { ascending: true })
          .limit(20),
        supabase
          .from('attendance_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .gte('clock_in_at', `${bangkokToday}T00:00:00+07:00`)
          .not('status', 'in', '(rejected,duplicate)'),
        supabase
          .from('company_members')
          .select('profile_id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('active', true),
      ])
      if (overdueError) throw overdueError
      if (clockedInError) throw clockedInError
      if (employeesError) throw employeesError

      const rows = (overdueRows ?? []) as unknown as OverdueSession[]
      setOverdue(rows)
      setStats({
        clockedInToday: clockedInToday ?? 0,
        needsReviewCount: rows.length,
        activeEmployees: activeEmployees ?? 0,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลภาพรวมไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <Stack spacing={2} sx={{ width: '100%', minWidth: 0, maxWidth: 900, mx: 'auto', pb: { xs: 9, sm: 2 } }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <Stack spacing={0.5}>
          <Typography variant="h5" sx={{ fontWeight: 850 }}>ภาพรวมวันนี้</Typography>
          <Typography variant="body2" color="text.secondary">
            {currentCompany?.company_name ?? 'WisdomAI'}
            {profile?.full_name ? ` • สวัสดี ${profile.full_name}` : ''}
          </Typography>
        </Stack>
      </Paper>

      {loading && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress size={28} aria-label="กำลังโหลดภาพรวม" />
        </Box>
      )}

      {!loading && error && <Alert severity="warning">{error}</Alert>}

      {!loading && !error && (
        <>
          {overdue.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 3,
                borderColor: 'error.main',
                bgcolor: (theme) => `${theme.palette.error.main}0D`,
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Avatar sx={{ bgcolor: 'error.main', width: 40, height: 40 }}>
                  <WarningAmberRoundedIcon />
                </Avatar>
                <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    ค้างลงเวลาออกเกินกำหนด ({overdue.length} คน)
                  </Typography>
                  {overdue.slice(0, 4).map((session) => (
                    <Stack
                      key={session.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                        {session.profiles?.full_name ?? 'ไม่ทราบชื่อ'} • {session.project_sites?.name ?? '-'}
                      </Typography>
                      <Chip size="small" color="error" label={overdueDuration(session.clock_in_at)} />
                    </Stack>
                  ))}
                  <Typography
                    variant="body2"
                    color="primary.main"
                    sx={{ fontWeight: 700, mt: 0.5, cursor: 'pointer' }}
                    onClick={() => navigate('/approvals')}
                  >
                    ตรวจสอบทั้งหมด →
                  </Typography>
                </Stack>
              </Stack>
            </Paper>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
            <StatCard icon={<TimerOutlinedIcon />} color="success.main" label="ลงเวลาวันนี้" value={stats.clockedInToday} />
            <StatCard icon={<PendingActionsRoundedIcon />} color="warning.main" label="รอตรวจสอบ" value={stats.needsReviewCount} />
            <StatCard icon={<GroupsRoundedIcon />} color="primary.main" label="พนักงานทั้งหมด" value={stats.activeEmployees} />
          </Box>
        </>
      )}

      <MobileBottomNav active="overview" />
    </Stack>
  )
}
