import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'
import { userError } from '../../utils/userError'
import { getPasswordResetRedirectUrl } from '../../utils/authRedirect'
import { registerAuthSecurityEvent } from '../../utils/authSecurityEvent'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [recoveryMessage, setRecoveryMessage] = useState('')
  const [loading, setLoading] = useState(false)

  usePageTitle('Login')

  const handleLogin = async () => {
    setLoading(true)
    setErrorMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      void supabase.rpc('register_login_attempt', {
        target_email: email.trim(),
        target_outcome: 'failure',
        target_reason: error.code ?? 'invalid_credentials',
        target_user_agent: navigator.userAgent,
      })
      setErrorMessage('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
      setLoading(false)
      return
    }

    setLoading(false)
    void supabase.rpc('register_login_attempt', {
      target_email: email.trim(),
      target_outcome: 'success',
      target_user_agent: navigator.userAgent,
    })
    const requested=(location.state as {from?:string}|null)?.from
    // Let ProtectedRoute/AppLauncher resolve the effective company role after
    // AuthContext finishes loading. The profile role read here is platform-level
    // and may not match the active company role.
    const safeDestination=requested?.startsWith('/')&&!requested.startsWith('//')?requested:'/'
    navigate(safeDestination, { replace: true })
  }

  const handleForgotPassword = async () => {
    setErrorMessage('')
    setRecoveryMessage('')
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setErrorMessage('กรุณากรอกอีเมลก่อนขอลิงก์ตั้งรหัสใหม่')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: getPasswordResetRedirectUrl(),
    })
    if (error) {
      const friendly = userError(error)
      setErrorMessage(friendly)
      void registerAuthSecurityEvent({
        email: normalizedEmail,
        eventType: 'password_recovery_failed',
        reason: error,
        severity: /rate_limit|429|banned/i.test(`${error.code ?? ''} ${error.message ?? ''}`) ? 'critical' : 'warning',
      })
    } else {
      setRecoveryMessage('หากอีเมลนี้มีบัญชี ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาตรวจกล่องจดหมายและ Spam')
    }
    setLoading(false)
  }

  return (
    <>
      <Box
        sx={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'background.default',
          py: 3,
        }}
      >
        <Container maxWidth={false} sx={{ maxWidth: 560, width: '100%' }}>
          <Paper
            elevation={0}
            variant="outlined"
            sx={{ p: { xs: 3, sm: 4 } }}
          >
            <Stack spacing={3} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <LockOutlinedIcon />
              </Avatar>

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>
                  Welcome back
                </Typography>

                <Typography color="text.secondary">
                  Sign in to WisdomAI
                </Typography>
              </Box>

              <Stack
                component="form"
                spacing={2}
                sx={{ width: '100%' }}
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleLogin()
                }}
              >
                {errorMessage && (
                  <Alert severity="error">{errorMessage}</Alert>
                )}
                {recoveryMessage && <Alert severity="success">{recoveryMessage}</Alert>}

                <TextField
                  label="Email address"
                  type="email"
                  required
                  fullWidth
                  autoComplete="email"
                  value={email}
                  disabled={loading}
                  onChange={(event) => setEmail(event.target.value)}
                />

                <TextField
                  label="Password"
                  type="password"
                  required
                  fullWidth
                  autoComplete="current-password"
                  value={password}
                  disabled={loading}
                  onChange={(event) => setPassword(event.target.value)}
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
                <Button
                  type="button"
                  variant="text"
                  disabled={loading}
                  onClick={() => void handleForgotPassword()}
                >
                  ลืมรหัสผ่าน / ตั้งรหัสใหม่
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Container>
      </Box>
    </>
  )
}

