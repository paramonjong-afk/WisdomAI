import { Navigate, Outlet } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'
import { getPostLoginDestination } from '../utils/authRouting'

export function PublicOnlyRoute() {
  const { session, profile, loading } = useAuth()
  if (loading) return <AuthLoadingScreen />
  if (session) {
    const destination = getPostLoginDestination(profile?.role)
    return <Navigate to={destination} replace />
  }
  return <Outlet />
}
