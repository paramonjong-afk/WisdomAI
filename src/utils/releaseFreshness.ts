import { releaseInfo } from '../lib/releaseInfo'

type ReleaseManifest = {
  revision?: unknown
}

type ReleaseFreshnessResult = 'current' | 'reloading' | 'unavailable' | 'guarded'

const refreshGuardPrefix = 'wisdomai:release-refresh:'
const refreshGuardWindowMs = 2 * 60_000
const backgroundCheckIntervalMs = 5 * 60_000
const minimumCheckIntervalMs = 60_000

let lastCheckedAt = 0
let checkInFlight: Promise<ReleaseFreshnessResult> | null = null

const normalizedRevision = (revision: unknown) =>
  typeof revision === 'string' ? revision.trim().toLowerCase().slice(0, 7) : ''

const refreshGuardKey = (revision: string) => `${refreshGuardPrefix}${revision}`

const buildReleaseUrl = () => {
  const manifestUrl = new URL('/release.json', window.location.origin)
  manifestUrl.searchParams.set('client_revision', normalizedRevision(releaseInfo.revision) || 'unknown')
  manifestUrl.searchParams.set('checked_at', String(Date.now()))
  return manifestUrl
}

const replaceWithCurrentRelease = (revision: string) => {
  const guardKey = refreshGuardKey(revision)
  const lastRefresh = Number(sessionStorage.getItem(guardKey) ?? 0)
  if (lastRefresh && Date.now() - lastRefresh <= refreshGuardWindowMs) return false

  sessionStorage.setItem(guardKey, String(Date.now()))
  const currentUrl = new URL(window.location.href)
  currentUrl.searchParams.set('__release', revision)
  window.location.replace(currentUrl.toString())
  return true
}

export const checkReleaseFreshness = async (): Promise<ReleaseFreshnessResult> => {
  const localRevision = normalizedRevision(releaseInfo.revision)
  if (!localRevision || localRevision === 'local') return 'current'

  try {
    const response = await fetch(buildReleaseUrl(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' },
    })
    if (!response.ok) return 'unavailable'

    const manifest = await response.json() as ReleaseManifest
    const remoteRevision = normalizedRevision(manifest.revision)
    if (!remoteRevision || remoteRevision === localRevision) return 'current'

    return replaceWithCurrentRelease(remoteRevision) ? 'reloading' : 'guarded'
  } catch {
    // A manifest/network failure must never block Login or the current workflow.
    return 'unavailable'
  }
}

const scheduleFreshnessCheck = (force = false) => {
  if (document.hidden || !navigator.onLine) return
  if (!force && Date.now() - lastCheckedAt < minimumCheckIntervalMs) return
  if (checkInFlight) return

  lastCheckedAt = Date.now()
  checkInFlight = checkReleaseFreshness().finally(() => { checkInFlight = null })
}

export const installReleaseFreshnessGuard = () => {
  scheduleFreshnessCheck(true)

  const handleVisibility = () => {
    if (!document.hidden) scheduleFreshnessCheck()
  }
  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) scheduleFreshnessCheck(true)
  }
  const handleOnline = () => scheduleFreshnessCheck(true)

  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('pageshow', handlePageShow)
  window.addEventListener('online', handleOnline)
  window.setInterval(() => scheduleFreshnessCheck(), backgroundCheckIntervalMs)
}
