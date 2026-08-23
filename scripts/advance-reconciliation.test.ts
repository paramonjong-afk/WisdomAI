import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultReconciliation, saveLocalReconciliation } from '../src/pages/AdvanceSettlements/advanceReconciliation.ts'

const page = readFileSync('src/pages/AdvanceSettlements/index.tsx', 'utf8')
const source = { advanceId: 'fixture-advance-001', advanceNumber: 'ADV-202608-9E7829', amountReceived: 3100, slipSender: 'XX ตามสลิป' }
const original = defaultReconciliation(source)
assert.equal(original.purposeType, 'ทดลองจ่าย')
assert.equal(original.projectName, 'Wisdom Power')
assert.equal(original.slipSender, 'XX ตามสลิป')
assert.equal(original.transferredAmount, 3100)

const storage = new Map<string, string>()
const originalWindow = globalThis.window
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: '127.0.0.1' }, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } })
const changed = { ...original, confirmedPayer: 'ผู้จ่ายจริง', expectedAmount: 3000, status: 'ยอดไม่ตรง' as const }
assert.equal(saveLocalReconciliation('fixture-company', original, changed, { id: 'admin-1', name: 'Admin Local' }, '').error, 'การแก้ข้อมูลสำคัญต้องระบุเหตุผล')
const saved = saveLocalReconciliation('fixture-company', original, changed, { id: 'admin-1', name: 'Admin Local' }, 'ยืนยันยอดทดลองจ่ายกับผู้เกี่ยวข้อง')
assert.equal(saved.error, null)
assert.equal(saved.data.difference, 100)
assert.equal(saved.data.audit[0]?.actorName, 'Admin Local')
assert.deepEqual(saved.data.audit[0]?.changes.confirmedPayer, { old: '', new: 'ผู้จ่ายจริง' })
assert.match(storage.values().next().value ?? '', /ผู้จ่ายจริง/)
Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true })

for (const needle of ['Remark กระทบยอดเงินเข้า', 'ผู้โอนตามสลิป (หลักฐานเดิม)', 'ผู้โอนที่ยืนยันแล้ว/ผู้จ่ายจริง', 'เหตุผลการแก้ไขข้อมูลสำคัญ', 'ประวัติ Remark', 'ไม่เขียน Production', 'กระทบยอดเงินเข้า']) {
  assert.match(page, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `page should contain ${needle}`)
}
console.log('advance reconciliation local fixture tests passed')
