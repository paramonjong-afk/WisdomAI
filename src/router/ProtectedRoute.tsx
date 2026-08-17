import { Alert, Box, Button, Stack } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'
import { getPostLoginDestination } from '../utils/authRouting'

let employeeEntryRedirectPending = true

export function ProtectedRoute() {
  const location = useLocation()
  const { session, profile, loading, error, refreshProfile } = useAuth()

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

  // A restored mobile tab can reopen /my-profile without visiting /login.
  // On every fresh document entry, force the first authenticated employee
  // destination to time tracking. In-app navigation remains unaffected.
  if (profile?.role === 'employee' && employeeEntryRedirectPending) {
    // This module-scoped flag is intentionally consumed once per page load.
    // eslint-disable-next-line react-hooks/globals
    employeeEntryRedirectPending = false
    if (location.pathname !== '/time-tracking' && location.pathname !== '/line-link') {
      return <Navigate to={getPostLoginDestination(profile.role)} replace />
    }
  }

  return <Outlet />
}
