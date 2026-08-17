export type WorkTimeInput = {
  clockInMinute: number
  clockOutMinute: number
  workStartMinute?: number
  workEndMinute?: number
  breakStartMinute?: number
  breakEndMinute?: number
  graceMinutes?: number
  standardMinutes?: number
  overtimeRoundMinutes?: number
  isWorkDay?: boolean
  approvedOvertime?: Array<{ startsAtMinute: number; endsAtMinute: number; approvedMinutes?: number }>
}

const overlap = (startA: number, endA: number, startB: number, endB: number) =>
  Math.max(0, Math.min(endA, endB) - Math.max(startA, startB))

export function calculateWorkTime(input: WorkTimeInput) {
  const workStart = input.workStartMinute ?? 8 * 60
  const workEnd = input.workEndMinute ?? 17 * 60
  const breakStart = input.breakStartMinute ?? 12 * 60
  const breakEnd = input.breakEndMinute ?? 13 * 60
  const grace = input.graceMinutes ?? 5
  const standard = input.standardMinutes ?? 8 * 60
  const overtimeRound = input.overtimeRoundMinutes ?? 15
  const isWorkDay = input.isWorkDay ?? true
  if (input.clockOutMinute < input.clockInMinute) throw new Error('Clock-out must not be before clock-in')

  const breakMinutes = overlap(input.clockInMinute, input.clockOutMinute, breakStart, breakEnd)
  const workedMinutes = Math.max(0, input.clockOutMinute - input.clockInMinute - breakMinutes)
  const normalBreak = overlap(
    Math.max(input.clockInMinute, workStart),
    Math.min(input.clockOutMinute, workEnd),
    breakStart,
    breakEnd,
  )
  const normalMinutes = isWorkDay ? Math.min(
    standard,
    Math.max(0, overlap(input.clockInMinute, input.clockOutMinute, workStart, workEnd) - normalBreak),
  ) : 0
  const lateMinutes = isWorkDay ? Math.max(0, input.clockInMinute - (workStart + grace)) : 0
  const earlyLeaveMinutes = isWorkDay ? Math.max(0, workEnd - input.clockOutMinute) : 0
  const overtimeMinutes = (input.approvedOvertime ?? []).reduce((sum, approved) => {
    const actual = isWorkDay
      ? overlap(input.clockInMinute, input.clockOutMinute, approved.startsAtMinute, Math.min(approved.endsAtMinute, workStart))
        + overlap(input.clockInMinute, input.clockOutMinute, Math.max(approved.startsAtMinute, workEnd), approved.endsAtMinute)
      : overlap(input.clockInMinute, input.clockOutMinute, approved.startsAtMinute, approved.endsAtMinute)
    const rounded = Math.floor(actual / overtimeRound) * overtimeRound
    return sum + Math.min(rounded, approved.approvedMinutes ?? Number.MAX_SAFE_INTEGER)
  }, 0)

  return {
    breakMinutes, workedMinutes, normalMinutes,
    overtimeMinutes: Math.min(overtimeMinutes, Math.max(0, workedMinutes - normalMinutes)),
    lateMinutes, earlyLeaveMinutes,
  }
}
