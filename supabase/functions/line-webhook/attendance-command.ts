export type LineAttendanceAction = 'clock_in' | 'clock_out'

const normalize = (value: string | undefined) => (value ?? '').trim().replace(/\s+/gu, '')

/**
 * Parse only directional LINE attendance commands.
 *
 * The generic word "ลงเวลา" is intentionally not an action: it is too
 * ambiguous to create a request and should continue through the normal
 * message path. Users must say "ลงเวลาเข้า" or "ลงเวลาออก" (or an explicit
 * equivalent) before LINE starts the attendance flow.
 */
export function parseLineAttendanceCommand(text: string | undefined): LineAttendanceAction | null {
  const normalized = normalize(text)
  const lower = normalized.toLowerCase()
  if (!normalized) return null

  if (['ลงเวลาเข้า', 'ลงเวลาเข้างาน', 'เข้างาน', 'เช็คอิน', 'clockin'].includes(lower)) return 'clock_in'
  if (['ลงเวลาออก', 'ลงเวลาออกงาน', 'เลิกงาน', 'เช็คเอาท์', 'clockout'].includes(lower)) return 'clock_out'

  // Keep natural phrases only when they contain an explicit direction.
  if (normalized.includes('ลงเวลา') || normalized.includes('บันทึกเวลา')) {
    if (normalized.includes('เข้า')) return 'clock_in'
    if (normalized.includes('ออก') || normalized.includes('เลิก')) return 'clock_out'
  }
  return null
}
