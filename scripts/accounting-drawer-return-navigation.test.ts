import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { safeInternalReturnPath } from '../src/utils/safeReturnPath.ts'

const holderReturn = '/advance-holders?holder_id=holder-1&transaction_id=transaction-1'

assert.equal(safeInternalReturnPath(holderReturn), holderReturn)
assert.equal(safeInternalReturnPath('/advance-settlements?transaction_id=transaction-1#evidence'), '/advance-settlements?transaction_id=transaction-1#evidence')
assert.equal(safeInternalReturnPath('https://outside.example/advance-holders'), null)
assert.equal(safeInternalReturnPath('//outside.example/advance-holders'), null)
assert.equal(safeInternalReturnPath('/%2f%2foutside.example'), null)
assert.equal(safeInternalReturnPath('/\\outside.example'), null)
assert.equal(safeInternalReturnPath(null), null)

const accountingPage = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
assert.match(accountingPage, /const safeReturnTo = safeInternalReturnPath\(requestedReturnTo\)/)
assert.match(accountingPage, /if \(safeReturnTo\) navigate\(safeReturnTo, \{ replace: true \}\)/)
assert.match(accountingPage, /onClick=\{closeSlipDetail\}>← กลับไปหน้าต้นทาง<\/Button>/)
assert.match(accountingPage, /<Button variant="contained" onClick=\{closeSlipDetail\}>ปิด<\/Button>/)
assert.match(accountingPage, /onClose=\{closeSlipDetail\}/)

console.log('accounting Drawer return navigation passed: safe internal return, preserved source context, close/backdrop parity and external redirect rejection')
