import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import { AppBar, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, ListSubheader, MenuItem, TextField, Toolbar, Tooltip, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, updateAppStatus } from '../lib/telemetry'
import { releaseHostLabel, releaseInfo, releaseLabel } from '../lib/releaseInfo'
import { brandAssets } from '../lib/brandAssets'
import { buildFreshLoginUrl } from '../utils/authRouting'
import { isPlatformAdmin as resolvePlatformAdmin } from '../utils/permissions'
import { applyPendingReleaseUpdate, getPendingReleaseRevision, releaseUpdateAvailableEvent } from '../utils/releaseFreshness'
import { NotificationBell } from '../components/NotificationBell'

export function TopBar({ onMenuOpen }: { onMenuOpen?: () => void }) {
  const navigate = useNavigate()
  const { profile, user, companies, currentCompany, switchCompany, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [pendingRelease, setPendingRelease] = useState(getPendingReleaseRevision)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const displayName = profile?.full_name || user?.email || 'Wisdom user'
  const role = profile?.role ?? 'employee'
  const isPlatformAdmin = resolvePlatformAdmin(profile)
  const initials = displayName.slice(0, 2).toUpperCase()

  useEffect(() => {
    const handleReleaseUpdate = (event: Event) => {
      const revision = (event as CustomEvent<{ revision?: string }>).detail?.revision?.trim() ?? ''
      if (revision) setPendingRelease(revision)
    }
    window.addEventListener(releaseUpdateAvailableEvent, handleReleaseUpdate)
    return () => window.removeEventListener(releaseUpdateAvailableEvent, handleReleaseUpdate)
  }, [])

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
        {pendingRelease && <Tooltip title="มีระบบรุ่นใหม่พร้อมใช้งาน งานปัจจุบันจะไม่ถูกรีเฟรชอัตโนมัติ">
          <Chip
            size="small"
            color="warning"
            label={<><Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>{`มีรุ่นใหม่ ${pendingRelease} · อัปเดตเมื่อพร้อม`}</Box><Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>มีรุ่นใหม่</Box></>}
            onClick={() => setUpdateDialogOpen(true)}
            sx={{ mr: 1, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
          />
        </Tooltip>}
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
      <Dialog open={updateDialogOpen} onClose={() => setUpdateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>มีระบบรุ่นใหม่พร้อมใช้งาน</DialogTitle>
        <DialogContent>
          <Typography>ระบบจะรีเฟรชหน้านี้เพื่ออัปเดตเป็นรุ่น {pendingRelease} กรุณาบันทึกแบบร่างหรืองานที่กำลังตรวจให้เรียบร้อยก่อน</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpdateDialogOpen(false)}>ทำงานต่อ</Button>
          <Button variant="contained" color="warning" onClick={() => applyPendingReleaseUpdate(pendingRelease)}>บันทึกแล้ว อัปเดตตอนนี้</Button>
        </DialogActions>
      </Dialog>
    </AppBar>
  )
}
