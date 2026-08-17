import LockResetOutlinedIcon from '@mui/icons-material/LockResetOutlined'
import {
  Alert, Avatar, Box, Button, CircularProgress, Container,
  Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

export function ResetPasswordPage() {
  usePageTitle('ตั้งรหัสผ่านใหม่')
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

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
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setErrorMessage(error.message)
    } else {
      setMessage('ตั้งรหัสผ่านใหม่เรียบร้อย กำลังกลับไปหน้า Login')
      await supabase.auth.signOut()
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    }
    setBusy(false)
  }

  return <>
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', py: 3 }}>
      <Container maxWidth="xs">
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ bgcolor: 'primary.main' }}><LockResetOutlinedIcon /></Avatar>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>ตั้งรหัสผ่านใหม่</Typography>
              <Typography color="text.secondary">เปิดหน้านี้จากลิงก์ที่ส่งไปทางอีเมล</Typography>
            </Box>
            {message && <Alert severity="success" sx={{ width: '100%' }}>{message}</Alert>}
            {errorMessage && <Alert severity="error" sx={{ width: '100%' }}>{errorMessage}</Alert>}
            <TextField fullWidth type="password" label="รหัสผ่านใหม่" autoComplete="new-password"
              value={password} onChange={(event) => setPassword(event.target.value)}
              helperText="อย่างน้อย 10 ตัวอักษร" />
            <TextField fullWidth type="password" label="ยืนยันรหัสผ่านใหม่" autoComplete="new-password"
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            <Button fullWidth size="large" variant="contained" disabled={busy || password.length < 10 || confirmPassword.length < 10}
              onClick={() => void submit()}>
              {busy ? <CircularProgress size={22} color="inherit" /> : 'บันทึกรหัสผ่านใหม่'}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  </>
}
