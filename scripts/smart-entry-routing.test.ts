import assert from 'node:assert/strict'
import { isMatchingRelease, median, sanitizeNextPath, selectBestTarget } from '../public/smart-entry.js'

assert.equal(sanitizeNextPath(null), '/login')
assert.equal(sanitizeNextPath('https://evil.example'), '/login')
assert.equal(sanitizeNextPath('//evil.example/path'), '/login')
assert.equal(sanitizeNextPath('/start.html'), '/login')
assert.equal(sanitizeNextPath('/reset-password?type=recovery'), '/reset-password?type=recovery')
assert.equal(median([90, 15, 40]), 40)
assert.equal(selectBestTarget([
  { id: 'a', available: true, latency: 80 },
  { id: 'b', available: true, latency: 35 },
])?.id, 'b')
assert.equal(selectBestTarget([{ id: 'a', available: false, latency: Number.POSITIVE_INFINITY }]), null)
assert.equal(isMatchingRelease({ release: { revision: 'abc1234' } }, { release: { revision: 'abc1234' } }), true)
assert.equal(isMatchingRelease({ release: { revision: 'abc1234' } }, { release: { revision: 'def5678' } }), false)
assert.equal(isMatchingRelease({ release: { revision: 'abc1234' } }, { release: null }), false)

console.log('smart-entry-routing: ok')
