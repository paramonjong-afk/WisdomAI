import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import { Badge, Chip, IconButton, Stack, Tooltip } from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { loadNotificationSnapshot } from '../services/notificationCenter'
import { canManageCompany } from '../utils/permissions'

export function NotificationBell() {
  const navigate = useNavigate()
  const { user, profile, currentCompany } = useAuth()
  const [summary, setSummary] = useState({ unread: 0, actionable: 0 })
  const profileId = user?.id ?? ''
  const companyId = currentCompany?.company_id ?? ''
  const canViewNotifications = canManageCompany(profile, currentCompany)
  useEffect(() => {
    if (!profileId || !companyId || !canViewNotifications) return undefined
    const load = async () => { try { const snapshot = await loadNotificationSnapshot({ companyId, profileId }); setSummary({ unread: snapshot.unreadCount, actionable: snapshot.actionableCount }) } catch { setSummary({ unread: 0, actionable: 0 }) } }
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => void load(), 30_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [canViewNotifications, companyId, profileId])
  if (!canViewNotifications) return null
  const label = `การแจ้งเตือน${summary.unread ? ` ${summary.unread} รายการยังไม่อ่าน` : ''}${summary.actionable ? `, ${summary.actionable} งานที่ต้องทำ` : ''}`
  return <Tooltip title={label}><Stack direction="row" spacing={0.5} sx={{ mr: 1, display: { xs: 'none', sm: 'inline-flex' }, alignItems: 'center' }}><IconButton aria-label={label} onClick={() => navigate('/notifications')}><Badge color="error" max={99} badgeContent={summary.unread > 99 ? '99+' : summary.unread} invisible={summary.unread === 0}><NotificationsNoneOutlinedIcon /></Badge></IconButton>{summary.actionable > 0 && <Chip size="small" color="warning" label={summary.actionable > 99 ? '99+' : summary.actionable} aria-label={`${summary.actionable} งานที่ต้องทำ`} />}</Stack></Tooltip>
}
