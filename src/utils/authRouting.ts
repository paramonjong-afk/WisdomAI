import type { ProfileRole } from '../types/auth'

export type EntryDevice = 'mobile' | 'desktop'

export interface DeviceDetectionInput {
  userAgent?: string
  maxTouchPoints?: number
  viewportWidth?: number
  coarsePointer?: boolean
}

const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i

/**
 * Detect the presentation surface, not authorization. The route guards remain
 * the authority for permissions after this convenience decision is made.
 */
export function detectEntryDevice(input?: DeviceDetectionInput): EntryDevice {
  const userAgent = input?.userAgent
    ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const maxTouchPoints = input?.maxTouchPoints
    ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0)
  const viewportWidth = input?.viewportWidth
    ?? (typeof window !== 'undefined' ? window.innerWidth : Number.POSITIVE_INFINITY)
  const coarsePointer = input?.coarsePointer
    ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false)

  if (mobileUserAgent.test(userAgent)) return 'mobile'
  if (maxTouchPoints > 0 && coarsePointer && viewportWidth <= 900) return 'mobile'
  return 'desktop'
}

export function getPostLoginDestination(
  role?: ProfileRole | null,
  device: EntryDevice = detectEntryDevice(),
) {
  // Keep mobile post-login at the launcher so the two primary destinations
  // remain separate: Time Tracking and Web Chat.
  if (device === 'mobile') return '/'
  if (role === 'admin' || role === 'manager') return '/dashboard'
  if (role === 'employee') return '/my-profile'
  // Do not guess a protected role while profile loading/fails. The launcher
  // remains the safe recovery page and can retry after AuthContext refreshes.
  return '/'
}

/**
 * Resolve the immediate destination after password login. Mobile always starts
 * at the launcher, even when ProtectedRoute remembered a deep route before an
 * explicit logout or session expiry. Desktop may safely restore that route;
 * otherwise AppLauncher resolves the role destination after profile loading.
 */
export function getLoginNavigationTarget(
  requested?: string | null,
  device: EntryDevice = detectEntryDevice(),
) {
  if (device === 'mobile') return '/'
  return requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/'
}
