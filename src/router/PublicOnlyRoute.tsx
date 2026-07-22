import { Navigate, Outlet } from 'react-router-dom'
import { AuthLoadingScreen } from '../components/AuthLoadingScreen'
import { useAuth } from '../hooks/useAuth'

export function PublicOnlyRoute() {
  const { session, loading } = useAuth()
  if (loading) return <AuthLoadingScreen />
  if (session) return <Navigate to="/" replace />
  return <Outlet />
}
