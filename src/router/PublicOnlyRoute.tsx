import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'

export function PublicOnlyRoute() {
  const location = useLocation()
  const { session, loading } = useAuth()
  if (loading) return <AuthLoadingScreen />
  if (session) {
    const requestedPath = (location.state as { from?: unknown } | null)?.from
    const destination = typeof requestedPath === 'string' && requestedPath.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/'
    return <Navigate to={destination} replace />
  }
  return <Outlet />
}
