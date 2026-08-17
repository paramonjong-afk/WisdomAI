import type { ProfileRole } from '../types/auth'

export function getPostLoginDestination(role?: ProfileRole | null) {
  return role === 'admin' || role === 'manager' ? '/dashboard' : '/time-tracking'
}
