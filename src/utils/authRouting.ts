import type { ProfileRole } from '../types/auth'

export function getPostLoginDestination(role?: ProfileRole | null) {
  // Every authenticated user starts at the compact launcher and chooses
  // Web Chat or Time Tracking explicitly. Protected routes still enforce role access.
  void role
  return '/'
}
