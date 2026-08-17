import assert from 'node:assert/strict'
import { getPostLoginDestination } from '../src/utils/authRouting.ts'

assert.equal(getPostLoginDestination('employee'), '/time-tracking')
assert.equal(getPostLoginDestination(null), '/time-tracking')
assert.equal(getPostLoginDestination(undefined), '/time-tracking')
assert.equal(getPostLoginDestination('manager'), '/dashboard')
assert.equal(getPostLoginDestination('admin'), '/dashboard')

console.log('auth routing tests passed')
