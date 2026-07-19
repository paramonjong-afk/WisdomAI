import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { Avatar, Box, Button, Container, CssBaseline, Paper, Stack, TextField, ThemeProvider, Typography, createTheme } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { usePageTitle } from '../../hooks/usePageTitle'

const theme = createTheme({ palette: { primary: { main: '#2563eb' } } })

export function LoginPage() {
  const navigate = useNavigate()
  usePageTitle('Login')

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#f5f7fb', py: 3 }}>
        <Container maxWidth="xs">
          <Paper elevation={0} variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <Stack spacing={3} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ bgcolor: 'primary.main' }}><LockOutlinedIcon /></Avatar>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" sx={{ fontWeight: 800 }}>Welcome back</Typography>
                <Typography color="text.secondary">Sign in to WisdomAI</Typography>
              </Box>
              <Stack component="form" spacing={2} sx={{ width: '100%' }} onSubmit={(event) => { event.preventDefault(); navigate('/') }}>
                <TextField label="Email address" type="email" required autoComplete="email" fullWidth />
                <TextField label="Password" type="password" required autoComplete="current-password" fullWidth />
                <Button type="submit" variant="contained" size="large">Sign in</Button>
              </Stack>
            </Stack>
          </Paper>
        </Container>
      </Box>
    </ThemeProvider>
  )
}
