import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined'
import {
  Alert, Avatar, Box, Button, CircularProgress, Container,
  Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { clearSensitiveRecoveryUrl, getAuthRecoveryUrlState } from '../../utils/authRecovery'
import { userError } from '../../utils/userError'
import { registerAuthSecurityEvent } from '../../utils/authSecurityEvent'

export function ResetPasswordPage() {
  usePageTitle('ตั้งรหัสผ่านใหม่')
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [checkingLink, setCheckingLink] = useState(true)
  const [canReset, setCanReset] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const recoveryError = useMemo(() => {
    const state = getAuthRecoveryUrlState()
    const code = state.errorCode
    if (code === 'otp_expired') return 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้แล้ว กรุณากลับหน้า Login และขอลิงก์ใหม่'
    if (code === 'access_denied') return 'ลิงก์ตั้งรหัสผ่านไม่สามารถใช้งานได้ กรุณาขอลิงก์ใหม่จากหน้า Login'
    if (state.hasRecoveryError) return state.errorDescription || 'ลิงก์ตั้งรหัสผ่านไม่สามารถใช้งานได้ กรุณาขอลิงก์ใหม่จากหน้า Login'
    return ''
  }, [])

  useEffect(() => {
    let active = true
    const prepareRecoverySession = async () => {
      const state = getAuthRecoveryUrlState()
      if (state.hasRecoveryError) {
        void registerAuthSecurityEvent({
          eventType: 'password_recovery_link_rejected',
          reason: {
            code: state.errorCode || 'recovery_link_error',
            message: state.errorDescription || 'Recovery link rejected by Supabase Auth',
          },
          severity: /banned|access_denied|otp_expired/i.test(`${state.errorCode ?? ''} ${state.errorDescription ?? ''}`) ? 'critical' : 'warning',
        })
        if (active) setCheckingLink(false)
        return
      }
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          void registerAuthSecurityEvent({
            eventType: 'password_recovery_exchange_failed',
            reason: error,
            severity: /banned|access_denied|otp_expired/i.test(`${error.code ?? ''} ${error.message ?? ''}`) ? 'critical' : 'warning',
          })
          if (active) setErrorMessage(userError(error))
        }
      }
      const { data } = await supabase.auth.getSession()
      if (active) {
        setCanReset(Boolean(data.session))
        setCheckingLink(false)
        if (data.session) clearSensitiveRecoveryUrl()
      }
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setCanReset(Boolean(session))
        setCheckingLink(false)
        if (session) clearSensitiveRecoveryUrl()
      }
    })
    void prepareRecoverySession()
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const submit = async () => {
    setMessage('')
    setErrorMessage('')
    if (password.length < 10) {
      setErrorMessage('รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร')
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }
    if (!canReset) {
      setErrorMessage('ยังไม่พบสิทธิ์ตั้งรหัสผ่านจากลิงก์นี้ กรุณาเปิดจากอีเมลล่าสุด หรือขอลิงก์ใหม่จากหน้า Login')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setErrorMessage(userError(error))
    } else {
      setMessage('ตั้งรหัสผ่านใหม่เรียบร้อย กำลังกลับไปหน้า Login')
      await supabase.auth.signOut()
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    }
    setBusy(false)
  }

  return <>
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', py: 3 }}>
      <Container maxWidth={false} sx={{ maxWidth: 560, width: '100%' }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: 'primary.main' }}><LockResetOutlinedIcon /></Avatar>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>ตั้งรหัสผ่านใหม่</Typography>
              <Typography color="text.secondary">เปิดหน้านี้จากลิงก์ที่ส่งไปทางอีเมล</Typography>
            </Box>
            {message && <Alert severity="success" sx={{ width: '100%' }}>{message}</Alert>}
            {checkingLink && <Alert severity="info" sx={{ width: '100%' }}>กำลังตรวจลิงก์ตั้งรหัสผ่าน...</Alert>}
            {(errorMessage || recoveryError) && <Alert severity="error" sx={{ width: '100%' }}>{errorMessage || recoveryError}</Alert>}
            {!checkingLink && !recoveryError && !canReset && <Alert severity="warning" sx={{ width: '100%' }}>ยังไม่พบ session สำหรับตั้งรหัสผ่าน กรุณาเปิดหน้านี้จากลิงก์ล่าสุดในอีเมล</Alert>}
            <TextField fullWidth type="password" label="รหัสผ่านใหม่" autoComplete="new-password"
              value={password} onChange={(event) => setPassword(event.target.value)}
              helperText="อย่างน้อย 10 ตัวอักษร" />
            <TextField fullWidth type="password" label="ยืนยันรหัสผ่านใหม่" autoComplete="new-password"
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            <Button fullWidth size="large" variant="contained" disabled={busy || checkingLink || !canReset || Boolean(recoveryError) || password.length < 10 || confirmPassword.length < 10}
              onClick={() => void submit()}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'บันทึกรหัสผ่านใหม่'}
            </Button>
            <Button fullWidth variant="text" disabled={busy} onClick={() => navigate('/login', { replace: true })}>
              กลับไปขอลิงก์ใหม่ที่หน้า Login
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  </>
}

