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
  'refreshGuardWindowMs',
  "document.addEventListener('visibilitychange'",
  "window.addEventListener('pageshow'",
  "window.addEventListener('online'",
]) {
  if (!freshness.includes(contract)) throw new Error(`Missing release freshness contract: ${contract}`)
}

if (!main.includes('installReleaseFreshnessGuard()')) {
  throw new Error('Release freshness guard must be installed before the React application renders')
}

for (const field of ['release_revision', 'release_host']) {
  if (!telemetry.includes(field)) throw new Error(`Missing release telemetry field: ${field}`)
}

for (const contract of ['Release Freshness Guard', 'no-store', '__release', 'sessionStorage']) {
  if (!flow.includes(contract)) throw new Error(`Missing Release Parity flow contract: ${contract}`)
}

console.log('release freshness contract: PASS')
