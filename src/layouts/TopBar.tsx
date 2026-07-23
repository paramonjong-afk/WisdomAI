import MenuIcon from '@mui/icons-material/Menu'
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined'
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined'
import { AppBar, Avatar, Badge, Box, IconButton, Toolbar, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, updateAppStatus } from '../lib/telemetry'

export function TopBar() {
  const navigate = useNavigate()
  const { profile, user, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const displayName = profile?.full_name || user?.email || 'Wisdom user'
  const role = profile?.role ?? 'employee'
  const initials = displayName.slice(0, 2).toUpperCase()

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      if (user) {
        await logAppEvent(user.id, { eventType: 'session_end' })
        await updateAppStatus(user.id, 'offline')
      }
      await signOut()
      navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <AppBar position="sticky" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <IconButton edge="start" sx={{ display: { md: 'none' }, mr: 1 }} aria-label="Open navigation">
          <MenuIcon />
        </IconButton>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Construction Management Platform
        </Typography>
        <Tooltip title="Notifications">
          <IconButton aria-label="Notifications" sx={{ mr: 1 }}>
            <Badge color="error" variant="dot"><NotificationsNoneOutlinedIcon /></Badge>
          </IconButton>
        </Tooltip>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Tooltip title="ข้อมูลส่วนตัว">
            <IconButton aria-label="ข้อมูลส่วนตัว" onClick={() => navigate('/my-profile')} sx={{ p: 0 }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>{initials}</Avatar>
            </IconButton>
          </Tooltip>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{displayName}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{role}</Typography>
          </Box>
          <Tooltip title="Sign out">
            <span>
              <IconButton aria-label="Sign out" disabled={signingOut} onClick={() => void handleSignOut()}>
                <LogoutOutlinedIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  )
}
