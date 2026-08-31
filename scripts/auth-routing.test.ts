import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildFreshLoginUrl, detectEntryDevice, getLoginNavigationTarget, getPostLoginDestination } from '../src/utils/authRouting.ts'

assert.equal(getPostLoginDestination('employee', 'mobile'), '/')
assert.equal(getPostLoginDestination('manager', 'mobile'), '/')
assert.equal(getPostLoginDestination('admin', 'mobile'), '/')
assert.equal(getPostLoginDestination('employee', 'desktop'), '/my-profile')
assert.equal(getPostLoginDestination('manager', 'desktop'), '/dashboard')
assert.equal(getPostLoginDestination('admin', 'desktop'), '/dashboard')
assert.equal(getPostLoginDestination(null, 'desktop'), '/')
assert.equal(getPostLoginDestination(undefined, 'desktop'), '/')
assert.equal(getPostLoginDestination('manager'), '/dashboard')
assert.equal(getPostLoginDestination('employee'), '/my-profile')

assert.equal(getLoginNavigationTarget('/chat', 'mobile'), '/', 'mobile login must not restore the previous Chat route')
assert.equal(getLoginNavigationTarget('/time-tracking', 'mobile'), '/', 'mobile login must always start at the launcher')
assert.equal(getLoginNavigationTarget('/chat', 'desktop'), '/chat', 'desktop login may restore a safe internal route')
assert.equal(getLoginNavigationTarget('//outside.example', 'desktop'), '/', 'protocol-relative destinations must be rejected')
assert.equal(getLoginNavigationTarget('https://outside.example', 'desktop'), '/', 'external destinations must be rejected')
assert.equal(getLoginNavigationTarget(undefined, 'desktop'), '/')

const freshLoginUrl = new URL(buildFreshLoginUrl('https://wisdomai.pages.dev', '0ea88c27d7', 1788150000000))
assert.equal(freshLoginUrl.origin, 'https://wisdomai.pages.dev')
assert.equal(freshLoginUrl.pathname, '/login')
assert.equal(freshLoginUrl.searchParams.get('__release'), '0ea88c2')
assert.equal(freshLoginUrl.searchParams.get('signed_out_at'), '1788150000000')

assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' }), 'mobile')
assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0, viewportWidth: 1440 }), 'desktop')
assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 5, viewportWidth: 390, coarsePointer: true }), 'mobile')

const topBar = readFileSync('src/layouts/TopBar.tsx', 'utf8')
assert.match(topBar, /component="summary"[\s\S]*wisdom-ai-app-icon-192\.png/, 'mobile menu trigger must use the Wisdom logo')
assert.doesNotMatch(topBar, /TimerOutlinedIcon|href="\/time-tracking"/, 'mobile header must not duplicate the Time Tracking launcher action')
assert.match(topBar, /aria-label="เปิดเมนูนำทาง"/, 'logo menu trigger must keep an accessible label')
assert.match(topBar, /window\.location\.replace\(buildFreshLoginUrl/, 'logout must perform a fresh document navigation')
assert.doesNotMatch(topBar, /navigate\('\/login'/, 'logout must not remain inside a stale SPA document')

console.log('auth routing tests passed')
