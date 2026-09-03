import assert from 'node:assert/strict'
import { payrollEmployeeLabel, payrollEmployeeOptions } from '../src/services/payrollEmployeeOptions.ts'

const options = payrollEmployeeOptions([
  { profile_id: 'active-id', employment_status: 'active', profiles: { full_name: 'คนปัจจุบัน' } },
  { profile_id: 'former-id', employment_status: 'resigned', profiles: { full_name: 'คนลาออก' } },
  { profile_id: 'former-id', employment_status: 'terminated', profiles: { full_name: 'คนลาออก' } },
])

assert.equal(options.length, 2, 'ประวัติการจ้างหลายแถวต้องไม่ทำให้ชื่อซ้ำ')
assert.deepEqual(options.map(option => option.id), ['active-id', 'former-id'], 'พนักงานปัจจุบันต้องแสดงก่อนอดีตพนักงาน')
assert.equal(options.find(option => option.id === 'former-id')?.isFormer, true, 'พนักงานลาออกต้องยังเลือกได้และมีสถานะกำกับ')
assert.match(payrollEmployeeLabel(options[1]), /อดีตพนักงาน/, 'UI ต้องแสดงป้ายกำกับเพื่อป้องกันการเลือกผิด')

console.log('accounting former employee allocation tests passed')
