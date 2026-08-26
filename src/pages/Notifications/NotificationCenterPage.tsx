import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined'
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined'
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import RefreshOutlinedIcon from '@mui/icons-material/RefreshOutlined'
import { Alert, Badge, Button, Card, CardContent, Chip, CircularProgress, Divider, MenuItem, Paper, Select, Stack, Tab, Tabs, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { loadNotificationSnapshot, type CenterNotification, type NotificationFilter, type NotificationPriority, type NotificationSnapshot } from '../../services/notificationCenter'
import { runWithMutationAttempt } from '../../utils/mutationAttemptRunner'
import { canManageCompany } from '../../utils/permissions'

const priorityColor = (value: NotificationPriority) => ({ urgent: 'error', review: 'warning', info: 'info', success: 'success' }[value] as 'error' | 'warning' | 'info' | 'success')
const priorityLabel = (value: NotificationPriority) => ({ urgent: 'เร่งด่วน', review: 'รอตรวจ/อนุมัติ', info: 'อัปเดตข้อมูล', success: 'สำเร็จ' }[value])
const priorityIcon = (value: NotificationPriority) => value === 'urgent' ? <ErrorOutlineOutlinedIcon color="error" /> : value === 'review' ? <AccessTimeOutlinedIcon color="warning" /> : value === 'success' ? <CheckCircleOutlineOutlinedIcon color="success" /> : <InfoOutlinedIcon color="info" />

export function NotificationCenterPage() {
  usePageTitle('ศูนย์การแจ้งเตือน')
  const { profile, user, currentCompany } = useAuth()
  const [params, setParams] = useSearchParams()
  const filter = (params.get('filter') as NotificationFilter | null) ?? 'all'
  const moduleFilter = params.get('module') ?? 'all'
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const companyId = currentCompany?.company_id ?? ''
  const profileId = user?.id ?? ''
  const canViewNotifications = canManageCompany(profile, currentCompany)
  const load = async () => { if (!canViewNotifications || !user?.id) return; setLoading(true); setError(''); try { setSnapshot(await loadNotificationSnapshot({ companyId, profileId })) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'โหลดแจ้งเตือนไม่สำเร็จ') } finally { setLoading(false) } }
  useEffect(() => { const refresh = async () => { if (!canViewNotifications || !profileId) return; setLoading(true); try { setSnapshot(await loadNotificationSnapshot({ companyId, profileId })) } catch { setError('โหลดแจ้งเตือนไม่สำเร็จ') } finally { setLoading(false) } }; const initial = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => void refresh(), 30_000); return () => { window.clearTimeout(initial); window.clearInterval(timer) } }, [canViewNotifications, companyId, profileId])
  const visibleItems = snapshot?.items.filter((item) => (moduleFilter === 'all' || item.module === moduleFilter) && (filter === 'all' || (filter === 'unread' && !item.read) || (filter === 'actionable' && item.kind === 'actionable') || (filter === 'system' && item.kind === 'informational'))) ?? []
  const markRead = async (item: CenterNotification) => {
    if (!user?.id || item.read) return
    try {
      await runWithMutationAttempt({ module: 'Notifications', action: 'บันทึกสถานะอ่านแจ้งเตือน', actorProfileId: user.id, companyId: currentCompany?.company_id ?? null, request: { notification_key: item.id }, operation: async () => supabase.from('notification_read_states').upsert({ profile_id: user.id, notification_key: item.id, read_at: new Date().toISOString() }) })
      setSnapshot((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? { ...row, read: true } : row), unreadCount: Math.max(0, current.unreadCount - 1) } : current)
    } catch {
      setError('บันทึกสถานะอ่านแล้วไม่สำเร็จ กรุณาลองใหม่')
    }
  }
  const setFilter = (value: NotificationFilter) => setParams((current) => { current.set('filter', value); return current })
  const setModuleFilter = (value: string) => setParams((current) => { if (value === 'all') current.delete('module'); else current.set('module', value); return current })
  if (!canViewNotifications) return <Alert severity="info">ศูนย์การแจ้งเตือนสำหรับ Admin และผู้จัดการบริษัท</Alert>
  return <Stack spacing={2} sx={{ minWidth: 0 }}>
    <PageHeader title="ศูนย์การแจ้งเตือน" description="รวมแจ้งเตือนและงานที่ต้องทำจาก Module ต่าง ๆ" action={<Button onClick={() => void load()} startIcon={<RefreshOutlinedIcon />}>รีเฟรช</Button>} />
    {error && <Alert severity="error">{error}</Alert>}
    {snapshot?.warning && <Alert severity="warning">{snapshot.warning}</Alert>}
    {snapshot && <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">ยังไม่อ่าน</Typography><Typography variant="h4" sx={{ fontWeight: 900 }}>{snapshot.unreadCount}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">งานที่ต้องทำ</Typography><Typography variant="h4" sx={{ fontWeight: 900 }}>{snapshot.actionableCount}</Typography></Paper><Paper variant="outlined" sx={{ p: 1.5, flex: 1 }}><Typography variant="caption">อัปเดตล่าสุด</Typography><Typography variant="body2" sx={{ mt: 1 }}>{new Date(snapshot.lastUpdated).toLocaleString('th-TH')}</Typography></Paper></Stack>}
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}><Tabs value={filter} onChange={(_, value) => setFilter(value)} variant="scrollable" allowScrollButtonsMobile><Tab value="all" label="ทั้งหมด" /><Tab value="unread" label={`ยังไม่อ่าน${snapshot?.unreadCount ? ` (${snapshot.unreadCount})` : ''}`} /><Tab value="actionable" label="งานที่ต้องทำ" /><Tab value="system" label="แจ้งเตือนระบบ" /></Tabs><Divider /><Stack direction="row" spacing={1} sx={{ p: 1, alignItems: 'center', flexWrap: 'wrap' }}><Typography variant="caption" color="text.secondary">กรอง Module</Typography><Select size="small" value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} aria-label="กรอง Module"><MenuItem value="all">ทุก Module</MenuItem><MenuItem value="HR">HR</MenuItem><MenuItem value="Accounting">บัญชี</MenuItem><MenuItem value="Advance">เงินสำรองจ่าย</MenuItem><MenuItem value="System">ระบบ</MenuItem><MenuItem value="Master Data">ข้อมูลกลาง</MenuItem></Select></Stack></Paper>
    {loading ? <Stack sx={{ alignItems: 'center', py: 8 }}><CircularProgress /></Stack> : visibleItems.length === 0 ? <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}><NotificationsNoneOutlinedIcon color="disabled" sx={{ fontSize: 48 }} /><Typography sx={{ mt: 1, fontWeight: 800 }}>ไม่มีรายการในมุมมองนี้</Typography></Paper> : <Stack spacing={1}>{visibleItems.map((item) => <Card key={item.id} variant="outlined" sx={{ borderLeft: 5, borderLeftColor: `${priorityColor(item.priority)}.main`, opacity: item.read ? 0.72 : 1 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ justifyContent: 'space-between' }}><Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>{priorityIcon(item.priority)}<Stack sx={{ minWidth: 0 }}><Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}><Typography sx={{ fontWeight: 900 }}>{item.title}</Typography>{!item.read && <Badge color="error" variant="dot" />}<Chip size="small" color={priorityColor(item.priority)} label={priorityLabel(item.priority)} /></Stack><Typography variant="body2" color="text.secondary">{item.detail}</Typography><Typography variant="caption" color="text.secondary">{item.type} · {item.module} · Owner: {item.owner} · {new Date(item.occurredAt).toLocaleString('th-TH')}</Typography><Typography variant="caption" color="text.secondary">Source: {item.source || '-'} · Ref: {item.referenceId || '-'}</Typography>{item.slaAt && <Typography variant="caption" color={item.overdue ? 'error' : 'text.secondary'}>SLA: {new Date(item.slaAt).toLocaleString('th-TH')}{item.overdue ? ' · เกินกำหนด' : ''}</Typography>}</Stack></Stack><Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}><Button size="small" component={Link} to={`${item.path}${item.referenceId ? `?notification_id=${encodeURIComponent(item.id)}&reference_id=${encodeURIComponent(item.referenceId)}` : ''}`} onClick={() => void markRead(item)} variant={item.kind === 'actionable' ? 'contained' : 'outlined'}>เปิดงาน</Button>{!item.read && <Button size="small" onClick={() => void markRead(item)}>อ่านแล้ว</Button>}</Stack></Stack></CardContent></Card>)}</Stack>}
  </Stack>
}
