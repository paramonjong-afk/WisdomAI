import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ui = readFileSync('src/pages/AccountingDocuments/index.tsx', 'utf8')
assert.match(ui, /useState\('active'\)/)
assert.match(ui, /!\['duplicate', 'dismissed'\]\.includes\(document\.status\)/)
assert.match(ui, /รายการใช้งาน \(ไม่รวมรายการซ้ำ\)/)
assert.match(ui, /ทุกสถานะ \(รวมประวัติ\)/)
console.log('accounting duplicate filter checks passed')
