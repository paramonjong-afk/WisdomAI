import { parseChatAttendanceCommand } from '../src/utils/chatAttendanceCommand.ts'

const cases: Array<[string, 'clock_in' | 'clock_out' | null]> = [
  ['แจ้งเข้างาน', 'clock_in'],
  ['ลงเวลาเข้า', 'clock_in'],
  ['แจ้ง เข้า งาน', 'clock_in'],
  ['เริ่มงาน', 'clock_in'],
  ['แจ้งออกงาน', 'clock_out'],
  ['เลิกงาน', 'clock_out'],
  ['สวัสดีครับ', null],
]

for (const [input, expected] of cases) {
  const actual = parseChatAttendanceCommand(input)?.action ?? null
  if (actual !== expected) throw new Error(`${input}: expected ${expected}, got ${actual}`)
}

console.log('chat attendance command parser checks passed')
