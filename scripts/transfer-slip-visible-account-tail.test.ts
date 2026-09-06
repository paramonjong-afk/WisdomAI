import assert from 'node:assert/strict'
import { visibleAccountTail, isVisibleAccountTail } from '../src/services/maskedBankAccount.ts'

assert.equal(visibleAccountTail('115-0-xxx728'), '728')
assert.equal(visibleAccountTail('006-3-xxx307'), '307')
assert.equal(visibleAccountTail('123-4-56789-0'), '7890')
assert.equal(visibleAccountTail('xx12'), null)
assert.equal(isVisibleAccountTail('728'), true)
assert.equal(isVisibleAccountTail('7890'), true)
assert.equal(isVisibleAccountTail('12'), false)
console.log('transfer slip visible account tail contract: PASS')
