import assert from 'node:assert/strict'
import { parseThaiBankSlipDate } from '../src/services/thaiBankSlipDate.ts'

assert.equal(parseThaiBankSlipDate('21 ส.ค. 69, 12:00'), '2026-08-21T12:00:00+07:00')
assert.equal(parseThaiBankSlipDate('7 ส.ค. 2569 - 10:01'), '2026-08-07T10:01:00+07:00')
assert.equal(parseThaiBankSlipDate('อ่านไม่ได้'), null)
console.log('thai bank slip date contract: PASS')
