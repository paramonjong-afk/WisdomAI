import { Alert, Box, Button, Stack } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'

export function ProtectedRoute() {
  const location = useLocation()
  const { session, loading, error, refreshProfile } = useAuth()

  if (loading) return <AuthLoadingScreen />
  if (!session) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />

  if (error) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 520 }}>
          <Alert severity="error">Unable to load your account: {error}</Alert>
          <Button variant="contained" onClick={() => void refreshProfile()}>Try again</Button>
        </Stack>
      </Box>
    )
  }

  return <Outlet />
}
