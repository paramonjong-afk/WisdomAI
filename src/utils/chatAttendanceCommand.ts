export type ChatAttendanceAction = 'clock_in' | 'clock_out'

export type ParsedChatAttendanceCommand = {
  action: ChatAttendanceAction
  text: string
}

const CLOCK_OUT_PATTERNS = [
  /แจ้ง\s*ออกงาน/u,
  /ลงเวลา\s*ออกงาน/u,
  /ลงเวลา\s*ออก/u,
  /เลิกงาน/u,
  /ออกงาน/u,
]

const CLOCK_IN_PATTERNS = [
  /แจ้ง\s*เข้างาน/u,
  /ลงเวลา\s*เข้างาน/u,
  /ลงเวลา\s*เข้า/u,
  /เข้างาน/u,
  /เริ่มงาน/u,
]

/** Detects the small, explicit Thai attendance command vocabulary used by Chat. */
export const parseChatAttendanceCommand = (value: string): ParsedChatAttendanceCommand | null => {
  const text = value.trim().replace(/\s+/gu, ' ')
  if (!text) return null
  const normalized = text.replace(/\s+/gu, '')
  if (CLOCK_OUT_PATTERNS.some((pattern) => pattern.test(normalized))) return { action: 'clock_out', text }
  if (CLOCK_IN_PATTERNS.some((pattern) => pattern.test(normalized))) return { action: 'clock_in', text }
  return null
}
