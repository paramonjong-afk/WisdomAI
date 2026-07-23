import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Container,
  CssBaseline,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'
import { supabase } from '../../lib/supabase'

const theme = createTheme({
  palette: {
    primary: {
      main: '#2563eb',
    },
  },
})

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
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
      setErrorMessage('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
      setLoading(false)
      return
    }

    setLoading(false)
    const requestedPath = (location.state as { from?: unknown } | null)?.from
    const destination = typeof requestedPath === 'string'
      && requestedPath.startsWith('/')
      && !requestedPath.startsWith('//')
      && requestedPath !== '/login'
      ? requestedPath
      : '/'
    navigate(destination, { replace: true })
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <Box
        sx={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          bgcolor: '#f5f7fb',
          py: 3,
        }}
      >
        <Container maxWidth="xs">
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
              </Stack>
            </Stack>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  )
}
