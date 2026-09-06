type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function normalizeAppBadgeCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(999, Math.floor(value))
}

/**
 * Mirrors the unread total to an installed PWA icon when the platform supports
 * the Badging API. The in-app badge remains the cross-platform source of truth.
 */
export async function syncAppBadge(value: number) {
  if (typeof navigator === 'undefined') return false

  const badgeNavigator = navigator as BadgeNavigator
  const count = normalizeAppBadgeCount(value)

  try {
    if (count === 0) {
      if (badgeNavigator.clearAppBadge) await badgeNavigator.clearAppBadge()
      else if (badgeNavigator.setAppBadge) await badgeNavigator.setAppBadge(0)
      else return false
    } else {
      if (!badgeNavigator.setAppBadge) return false
      await badgeNavigator.setAppBadge(count)
    }
    return true
  } catch {
    // Badging can be denied by the OS/browser. Never block the in-app unread UI.
    return false
  }
}
