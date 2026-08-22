import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import { Alert, Avatar, Badge, Box, ButtonBase, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { fetchChatUnreadCount } from '../../services/chatUnread'

export function AppLauncherPage() {
  usePageTitle('เลือกเมนู')
  const navigate = useNavigate()
  const { user, profile, currentCompany } = useAuth()
  const companyId = currentCompany?.company_id ?? ''
  const profileId = user?.id ?? profile?.id ?? ''
  const [unreadCount, setUnreadCount] = useState(0)
  const [loadingUnread, setLoadingUnread] = useState(true)
  const [unreadError, setUnreadError] = useState('')

  const loadUnreadCount = useCallback(async () => {
    if (!companyId || !profileId) {
      setUnreadCount(0)
      setLoadingUnread(false)
      return
    }
    try {
      const count = await fetchChatUnreadCount({ companyId, profileId })
      setUnreadCount(count)
      setUnreadError('')
    } catch (error) {
      setUnreadError(error instanceof Error ? error.message : 'ไม่สามารถอ่านจำนวนข้อความค้างได้')
    } finally {
      setLoadingUnread(false)
    }
  }, [companyId, profileId])

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => void loadUnreadCount(), 0)
    if (!companyId || !profileId) return () => window.clearTimeout(initialLoadTimer)

    const refreshTimer = window.setInterval(() => void loadUnreadCount(), 30_000)
    const channel = supabase
      .channel(`chat-launcher-unread:${companyId}:${profileId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `company_id=eq.${companyId}`,
      }, () => {
        void loadUnreadCount()
      })
      .subscribe()

    return () => {
      window.clearTimeout(initialLoadTimer)
      window.clearInterval(refreshTimer)
      void supabase.removeChannel(channel)
    }
  }, [companyId, loadUnreadCount, profileId])

  return (
    <Stack spacing={2} sx={{ width: '100%', minWidth: 0, maxWidth: 900, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <Stack spacing={0.5} sx={{ textAlign: 'center' }}>
          <Avatar
            src="/branding/wisdom-ai-app-icon-192.png"
            alt="WISDOM POWER SYSTEM"
            variant="rounded"
            sx={{ width: 64, height: 64, mx: 'auto', mb: 0.5, borderRadius: 2, boxShadow: '0 8px 24px rgba(22, 37, 68, .18)' }}
          />
          <Typography variant="h5" sx={{ fontWeight: 850 }}>เลือกเมนู</Typography>
          <Typography variant="body2" color="text.secondary">
            {currentCompany?.company_name ?? 'WisdomAI'}
          </Typography>
        </Stack>

        {unreadError && !loadingUnread && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            ยังอ่านจำนวนข้อความค้างไม่ได้ ระบบจะลองตรวจสอบใหม่อัตโนมัติ
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5, mt: 3 }}>
          <ButtonBase
            component="button"
            type="button"
            onClick={() => navigate('/chat')}
            aria-label={`เปิด Web Chat${unreadCount ? ` มี ${unreadCount} ข้อความยังไม่ได้อ่าน` : ''}`}
            sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 3 }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, minHeight: 190, borderRadius: 3, transition: 'transform .18s, box-shadow .18s', '&:hover': { transform: 'translateY(-2px)', boxShadow: 4, borderColor: 'primary.main' } }}>
              <Stack spacing={1.25} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <Badge
                  color="error"
                  max={99}
                  badgeContent={unreadCount > 99 ? '99+' : unreadCount}
                  invisible={unreadCount === 0}
                  overlap="circular"
                  sx={{ '& .MuiBadge-badge': { fontWeight: 800, minWidth: 24, height: 24 } }}
                >
                  <Avatar sx={{ width: 76, height: 76, bgcolor: 'primary.main' }}>
                    <ChatBubbleOutlineOutlinedIcon sx={{ fontSize: 38 }} />
                  </Avatar>
                </Badge>
                <Typography variant="h6" sx={{ fontWeight: 850 }}>Web Chat</Typography>
                <Typography variant="body2" color="text.secondary">
                  พูดคุย ส่งรูป/ไฟล์ และแจ้งลงเวลา
                </Typography>
                {loadingUnread && <CircularProgress size={18} aria-label="กำลังตรวจข้อความใหม่" />}
              </Stack>
            </Paper>
          </ButtonBase>

          <ButtonBase
            component="button"
            type="button"
            onClick={() => navigate('/time-tracking')}
            aria-label="เปิดหน้าลงเวลา"
            sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 3 }}
          >
            <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, minHeight: 190, borderRadius: 3, transition: 'transform .18s, box-shadow .18s', '&:hover': { transform: 'translateY(-2px)', boxShadow: 4, borderColor: 'success.main' } }}>
              <Stack spacing={1.25} sx={{ alignItems: 'center', textAlign: 'center' }}>
                <Avatar sx={{ width: 76, height: 76, bgcolor: 'success.main' }}>
                  <TimerOutlinedIcon sx={{ fontSize: 38 }} />
                </Avatar>
                <Typography variant="h6" sx={{ fontWeight: 850 }}>ลงเวลา</Typography>
                <Typography variant="body2" color="text.secondary">
                  ตรวจ GPS ถ่าย Selfie และยืนยันเวลา
                </Typography>
              </Stack>
            </Paper>
          </ButtonBase>
        </Box>
      </Paper>
    </Stack>
  )
}
