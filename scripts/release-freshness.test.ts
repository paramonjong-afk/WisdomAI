import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const freshness = readFileSync(resolve(root, 'src/utils/releaseFreshness.ts'), 'utf8')
const main = readFileSync(resolve(root, 'src/main.tsx'), 'utf8')
const telemetry = readFileSync(resolve(root, 'src/components/AppTelemetry.tsx'), 'utf8')
const flow = readFileSync(resolve(root, 'docs/RELEASE_PARITY_FLOW.md'), 'utf8')

for (const contract of [
  "new URL('/release.json', window.location.origin)",
  "cache: 'no-store'",
  "headers: { 'cache-control': 'no-cache' }",
  "currentUrl.searchParams.set('__release', revision)",
  'window.location.replace(currentUrl.toString())',
  "const pendingReleaseKey = 'wisdomai:pending-release'",
  "export const releaseUpdateAvailableEvent = 'wisdomai:release-update-available'",
  'return announceReleaseUpdate(remoteRevision)',
  "['/login', '/reset-password'].includes(window.location.pathname)",
  'refreshGuardWindowMs',
  "document.addEventListener('visibilitychange'",
  "window.addEventListener('pageshow'",
  "window.addEventListener('online'",
]) {
  if (!freshness.includes(contract)) throw new Error(`Missing release freshness contract: ${contract}`)
}

if (/^\s+return replaceWithCurrentRelease\(remoteRevision\) \?/m.test(freshness)) {
  throw new Error('Authenticated workflows must not reload automatically when a new release is detected')
}

if (!main.includes('installReleaseFreshnessGuard()')) {
  throw new Error('Release freshness guard must be installed before the React application renders')
}

const topBar = readFileSync(resolve(root, 'src/layouts/TopBar.tsx'), 'utf8')
for (const contract of ['มีรุ่นใหม่', 'อัปเดตเมื่อพร้อม', 'ทำงานต่อ', 'บันทึกแล้ว อัปเดตตอนนี้', 'applyPendingReleaseUpdate']) {
  if (!topBar.includes(contract)) throw new Error(`Missing non-interrupting update UI: ${contract}`)
}

for (const field of ['release_revision', 'release_host']) {
  if (!telemetry.includes(field)) throw new Error(`Missing release telemetry field: ${field}`)
}

for (const contract of ['Release Freshness Guard', 'no-store', '__release', 'sessionStorage', 'อัปเดตเมื่อพร้อม']) {
  if (!flow.includes(contract)) throw new Error(`Missing Release Parity flow contract: ${contract}`)
}

console.log('release freshness contract: PASS')
