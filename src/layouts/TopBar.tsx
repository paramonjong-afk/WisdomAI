import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import { AppBar, Avatar, Box, Chip, Divider, IconButton, ListSubheader, MenuItem, TextField, Toolbar, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, updateAppStatus } from '../lib/telemetry'
import { releaseHostLabel, releaseInfo, releaseLabel } from '../lib/releaseInfo'
import { isPlatformAdmin as resolvePlatformAdmin } from '../utils/permissions'
import { NotificationBell } from '../components/NotificationBell'


export function TopBar({ onMenuOpen }: { onMenuOpen?: () => void }) {
  const navigate = useNavigate()
  const { profile, user, companies, currentCompany, switchCompany, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const displayName = profile?.full_name || user?.email || 'Wisdom user'
  const role = profile?.role ?? 'employee'
  const isPlatformAdmin = resolvePlatformAdmin(profile)
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
        <Tooltip title="เปิดเมนูนำทาง">
          <IconButton
            aria-label="เปิดเมนูนำทาง"
            onClick={onMenuOpen}
            sx={{
              display: { xs: 'block', md: 'none' },
              '@media (pointer: coarse)': { display: 'block' },
              mr: 1,
              position: 'relative',
              flexShrink: 0,
              width: 44,
              height: 44,
            }}
          >
            <Box component="span" sx={{ fontSize: 26, lineHeight: 1 }}>☰</Box>
          </IconButton>
        </Tooltip>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}>
          {currentCompany?.company_name ?? 'Construction Management Platform'}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 0, display: { xs: 'block', sm: 'none' } }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>{currentCompany?.company_name ?? 'WisdomAI'}</Typography>
          <Typography variant="caption" noWrap color="text.secondary">{displayName} · {role}</Typography>
        </Box>
        <Tooltip title="ลงเวลา">
          <IconButton
            component="a"
            href="/time-tracking"
            color="primary"
            aria-label="ลงเวลา"
            sx={{
              display: { xs: 'inline-flex', md: 'none' },
              '@media (pointer: coarse)': { display: 'inline-flex' },
              mr: 1,
              width: 44,
              height: 44,
              border: '1px solid',
              borderColor: 'primary.main',
            }}
          >
            <TimerOutlinedIcon />
          </IconButton>
        </Tooltip>
        {(companies.length>1||isPlatformAdmin)&&<TextField
          select size="small" aria-label="เลือกบริษัท" value={currentCompany?.company_id??''}
          onChange={(event)=>event.target.value==='__platform__'?navigate('/platform-control-center'):void switchCompany(event.target.value)}
          sx={{minWidth:180,mr:1,display:{xs:'none',md:'block'}}}
        >
          {isPlatformAdmin&&<ListSubheader>Platform Mode</ListSubheader>}
          {isPlatformAdmin&&<MenuItem value="__platform__">ศูนย์จัดการระบบกลาง</MenuItem>}
          {isPlatformAdmin&&<Divider/>}
          {companies.map(company=><MenuItem key={company.company_id} value={company.company_id}>{company.company_name}</MenuItem>)}
        </TextField>}
        <Tooltip title={`รุ่นที่กำลังใช้งาน: ${releaseHostLabel} · ${releaseLabel} · สร้าง ${new Date(releaseInfo.builtAt).toLocaleString('th-TH')} · กดเพื่อดูรายละเอียด`}>
          <Chip
            size="small"
            variant="outlined"
            label={`${releaseHostLabel} · ${releaseLabel}`}
            onClick={() => navigate('/system-health')}
            sx={{ mr: 1, cursor: 'pointer', display: { xs: 'none', md: 'inline-flex' }, fontVariantNumeric: 'tabular-nums' }}
          />
        </Tooltip>
        <NotificationBell />
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
