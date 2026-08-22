import assert from 'node:assert/strict'
import { getPostLoginDestination } from '../src/utils/authRouting.ts'

assert.equal(getPostLoginDestination('employee'), '/')
assert.equal(getPostLoginDestination(null), '/')
assert.equal(getPostLoginDestination(undefined), '/')
assert.equal(getPostLoginDestination('manager'), '/')
assert.equal(getPostLoginDestination('admin'), '/')

console.log('auth routing tests passed')
