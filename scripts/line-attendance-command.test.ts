import assert from 'node:assert/strict'
import { parseLineAttendanceCommand } from '../supabase/functions/line-webhook/attendance-command.ts'

const cases: Array<[string, 'clock_in' | 'clock_out' | null]> = [
  ['ลงเวลา', null],
  ['ลงเวลาทำงาน', null],
  ['บันทึกเวลา', null],
  ['บันทึกเวลาทำงาน', null],
  ['ลงเวลาเข้า', 'clock_in'],
  ['ลงเวลาเข้างาน', 'clock_in'],
  ['แจ้ง ลงเวลา เข้า งาน', 'clock_in'],
  ['ลงเวลาออก', 'clock_out'],
  ['ลงเวลาออกงาน', 'clock_out'],
  ['แจ้งลงเวลาเลิกงาน', 'clock_out'],
  ['สวัสดีครับ', null],
]

for (const [input, expected] of cases) {
  assert.equal(parseLineAttendanceCommand(input), expected, `${input}: expected ${expected}`)
}

console.log('LINE attendance command parser checks passed')
