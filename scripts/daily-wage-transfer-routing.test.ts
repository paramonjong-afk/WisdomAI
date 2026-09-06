import assert from 'node:assert/strict'
import { groupDailyWageTransfers } from '../src/services/dailyWageTransferRouting.ts'

const rows = [
  { id: '1', employeeProfileId: 'e1', employeeName: 'ช่างหนึ่ง', transferDate: '2026-08-25', amount: 400, status: 'pending' },
  { id: '2', employeeProfileId: 'e1', employeeName: 'ช่างหนึ่ง', transferDate: '2026-08-25', amount: 600, status: 'confirmed' },
  { id: '3', employeeProfileId: 'e2', employeeName: 'ช่างสอง', transferDate: '2026-08-24', amount: 500, status: 'pending' },
]

const groups = groupDailyWageTransfers(rows)
assert.equal(groups.length, 2)
assert.equal(groups[0].total, 1000)
assert.equal(groups[0].count, 2)
assert.equal(groups[1].employeeName, 'ช่างสอง')
console.log('daily wage transfer routing tests passed')
