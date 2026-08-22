import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'
import { passwordResetRouteFromCurrentUrl, shouldRouteToResetPassword } from '../utils/authRecovery'
import { getPostLoginDestination } from '../utils/authRouting'

export function PublicOnlyRoute() {
  const location = useLocation()
  const { session, profile, loading } = useAuth()
  if (shouldRouteToResetPassword(location.pathname, location.search, location.hash)) {
    return <Navigate to={passwordResetRouteFromCurrentUrl(location.search, location.hash)} replace />
  }
  if (loading) return <AuthLoadingScreen />
  if (session) {
    const destination = getPostLoginDestination(profile?.role)
    return <Navigate to={destination} replace />
  }
  return <Outlet />
}
