import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { getPostLoginDestination } from '../utils/authRouting'

export function LandingRoute() {
  const { profile } = useAuth()
  return <Navigate to={getPostLoginDestination(profile?.role)} replace />
}
