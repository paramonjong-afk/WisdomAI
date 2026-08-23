import { strict as assert } from 'node:assert'
import { classifyIntake, reconcileClassificationCounts } from '../src/services/intakeClassificationGateway.ts'

const cases = [
  { id: 'slip', rawText: 'สลิปโอนเงิน ธนาคาร ยอดเงิน', expect: 'accounting' },
  { id: 'hr', rawText: 'ช่างสมชาย ลงเวลาเข้า โครงการ A', expect: 'hr_attendance' },
  { id: 'payroll', rawText: 'สรุปค่าแรง payroll ช่าง', expect: 'payroll' },
  { id: 'advance', rawText: 'เบิกล่วงหน้า เงินสำรอง ทดลองจ่าย', expect: 'advance_finance' },
  { id: 'project', rawText: 'รายงานหน้างาน โครงการ ไซต์งาน', expect: 'project_site' },
  { id: 'ambiguous', rawText: 'ช่วยดูรายการนี้', expect: 'intake_review' },
  { id: 'duplicate', rawText: 'สลิปโอนเงิน', duplicateOf: 'slip', expect: 'intake_review' },
  { id: 'system', rawText: 'สรุปรายวัน HR', isSystemSummary: true, expect: 'hr_attendance' },
]

const results = cases.map((item) => classifyIntake(item))
assert.deepEqual(results.map((item) => item.destination), ['accounting', 'hr_attendance', 'payroll', 'advance_finance', 'project_site', 'intake_review', 'intake_review', 'hr_attendance'])
assert.equal(results[6].policy, 'duplicate_hold')
assert.equal(results[7].policy, 'system_context')
assert.equal(results[5].policy, 'intake_review')
assert.ok(results.every((item) => item.rule_version && item.model_version && item.reason))
const counts = reconcileClassificationCounts(results)
assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), cases.length)
assert.equal(counts.accounting, 1)
assert.equal(counts.hr_attendance, 1)
assert.equal(counts.duplicate, 1)
assert.equal(counts.system_context, 1)
console.log('intake classification gateway contracts passed')
