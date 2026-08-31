import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined'
import { AppBar, Avatar, Box, Chip, Divider, IconButton, ListSubheader, MenuItem, Paper, TextField, Toolbar, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, updateAppStatus } from '../lib/telemetry'
import { releaseHostLabel, releaseInfo, releaseLabel } from '../lib/releaseInfo'
import { brandAssets } from '../lib/brandAssets'
import { buildFreshLoginUrl } from '../utils/authRouting'
import { navigationItems } from '../utils/navigation'
import { isPlatformAdmin as resolvePlatformAdmin } from '../utils/permissions'
import { NotificationBell } from '../components/NotificationBell'

const mobileNavigationItems = navigationItems.filter(
  (item) => item.path === '/time-tracking' || item.path === '/my-profile',
)

export function TopBar() {
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
      window.location.replace(buildFreshLoginUrl(window.location.origin, releaseInfo.revision))
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <AppBar position="sticky" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar>
        <Box
          component="details"
          sx={{
            display: { xs: 'block', md: 'none' },
            '@media (pointer: coarse)': { display: 'block' },
            mr: 1,
            position: 'relative',
            flexShrink: 0,
          }}
        >
          <Box
            component="summary"
            aria-label="เปิดเมนูนำทาง"
            sx={{
              width: 48,
              height: 48,
              display: 'grid',
              placeItems: 'center',
              fontSize: 30,
              lineHeight: 1,
              cursor: 'pointer',
              listStyle: 'none',
              touchAction: 'manipulation',
              userSelect: 'none',
              '&::-webkit-details-marker': { display: 'none' },
            }}
          >
            <Box
              component="img"
              src={brandAssets.transparentMark}
              alt=""
              sx={{
                width: 44,
                height: 'auto',
                display: 'block',
              }}
            />
          </Box>
          <Paper elevation={12} sx={{
            position: 'absolute', zIndex: 2147483647, top: 52, left: 0,
            width: 'min(86vw, 320px)', maxHeight: '75vh', overflowY: 'auto', p: 1,
          }}>
            {mobileNavigationItems.map((item) => <Box
              component="a" key={item.path} href={item.path}
              sx={{
                display: 'block', minHeight: 48, px: 2, py: 1.5,
                color: 'text.primary', textDecoration: 'none', borderRadius: 1,
                fontWeight: item.path === '/time-tracking' ? 800 : 600,
                bgcolor: item.path === '/time-tracking' ? 'action.selected' : 'transparent',
              }}
            >
              {item.path === '/time-tracking' ? '⏱ ลงเวลาของฉัน' : '👤 ข้อมูลส่วนตัว'}
            </Box>)}
            <Box
              component="button"
              type="button"
              disabled={signingOut}
              onClick={() => void handleSignOut()}
              sx={{
                width: '100%',
                minHeight: 48,
                px: 2,
                py: 1.5,
                border: 0,
                borderTop: 1,
                borderColor: 'divider',
                bgcolor: 'transparent',
                color: 'text.primary',
                textAlign: 'left',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
                '&:active': { bgcolor: 'action.selected' },
              }}
            >
              👥 ลงเวลาให้ผู้อื่น (เปลี่ยนบัญชี)
            </Box>
          </Paper>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}>
          {currentCompany?.company_name ?? 'Construction Management Platform'}
        </Typography>
        <Box sx={{ flexGrow: 1, display: { xs: 'block', sm: 'none' } }} />
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
