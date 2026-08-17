import assert from 'node:assert/strict'
import { calculateWorkTime } from '../src/utils/workTime.ts'

assert.deepEqual(calculateWorkTime({ clockInMinute: 480, clockOutMinute: 1020 }), {
  breakMinutes: 60, workedMinutes: 480, normalMinutes: 480,
  overtimeMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0,
})

assert.deepEqual(calculateWorkTime({ clockInMinute: 495, clockOutMinute: 1020 }), {
  breakMinutes: 60, workedMinutes: 465, normalMinutes: 465,
  overtimeMinutes: 0, lateMinutes: 10, earlyLeaveMinutes: 0,
})

assert.equal(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1140,
  approvedOvertime: [],
}).overtimeMinutes, 0)

assert.equal(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1140,
  approvedOvertime: [{ startsAtMinute: 1020, endsAtMinute: 1140 }],
}).overtimeMinutes, 120)

assert.equal(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1117,
  approvedOvertime: [{ startsAtMinute: 1020, endsAtMinute: 1140 }],
}).overtimeMinutes, 90)

assert.equal(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1140,
  approvedOvertime: [{ startsAtMinute: 900, endsAtMinute: 1140 }],
}).overtimeMinutes, 120)

assert.equal(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1140,
  approvedOvertime: [{ startsAtMinute: 1020, endsAtMinute: 1140, approvedMinutes: 60 }],
}).overtimeMinutes, 60)

assert.deepEqual(calculateWorkTime({
  clockInMinute: 480, clockOutMinute: 1020, isWorkDay: false,
  approvedOvertime: [{ startsAtMinute: 480, endsAtMinute: 1020 }],
}), {
  breakMinutes: 60, workedMinutes: 480, normalMinutes: 0,
  overtimeMinutes: 480, lateMinutes: 0, earlyLeaveMinutes: 0,
})

assert.throws(() => calculateWorkTime({ clockInMinute: 1020, clockOutMinute: 480 }))

console.log('workforce calculation tests passed')
