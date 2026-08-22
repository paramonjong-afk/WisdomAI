import assert from 'node:assert/strict'
import { detectEntryDevice, getPostLoginDestination } from '../src/utils/authRouting.ts'

assert.equal(getPostLoginDestination('employee', 'mobile'), '/time-tracking')
assert.equal(getPostLoginDestination('manager', 'mobile'), '/time-tracking')
assert.equal(getPostLoginDestination('admin', 'mobile'), '/time-tracking')
assert.equal(getPostLoginDestination('employee', 'desktop'), '/my-profile')
assert.equal(getPostLoginDestination('manager', 'desktop'), '/dashboard')
assert.equal(getPostLoginDestination('admin', 'desktop'), '/dashboard')
assert.equal(getPostLoginDestination(null, 'desktop'), '/')
assert.equal(getPostLoginDestination(undefined, 'desktop'), '/')
assert.equal(getPostLoginDestination('manager'), '/dashboard')
assert.equal(getPostLoginDestination('employee'), '/my-profile')

assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' }), 'mobile')
assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0, viewportWidth: 1440 }), 'desktop')
assert.equal(detectEntryDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 5, viewportWidth: 390, coarsePointer: true }), 'mobile')

console.log('auth routing tests passed')
