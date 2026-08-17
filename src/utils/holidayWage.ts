export type HolidayWageInput = {
  isHoliday: boolean
  employmentType: string
  workedMinutes: number
  standardMinutes: number
  dailyRate: number
  monthlyDailyRate?: number
  approvedOvertimeMinutes?: number
  overtimeHourlyRate?: number
  multiplier?: number | null
  holidayOvertimeMinutes?: number | null
  reviewBlocked?: boolean
}

export type HolidayWageResult = {
  dayUnits: 0 | 0.5 | 1
  multiplier: number
  normalPay: number
  holidayPay: number
  normalOvertimePay: number
  holidayOvertimePay: number
  netPay: number
  needsHolidayReview: boolean
}

export function calculateWorkedDayUnits(workedMinutes: number, standardMinutes: number): 0 | 0.5 | 1 {
  const worked = Math.max(0, Number(workedMinutes || 0))
  const standard = Math.max(1, Number(standardMinutes || 480))
  if (worked >= standard) return 1
  if (worked >= standard / 2) return 0.5
  return 0
}

export function calculateHolidayWage(input: HolidayWageInput): HolidayWageResult {
  const dayUnits = input.reviewBlocked ? 0 : calculateWorkedDayUnits(input.workedMinutes, input.standardMinutes)
  const multiplier = input.isHoliday ? Number(input.multiplier ?? 1) : 1
  const dailyBase = input.employmentType === 'monthly'
    ? Math.max(0, Number(input.monthlyDailyRate ?? 0))
    : Math.max(0, Number(input.dailyRate ?? 0))
  const approvedOt = Math.max(0, Number(input.approvedOvertimeMinutes ?? 0))
  const normalOtRate = Math.max(0, Number(input.overtimeHourlyRate ?? 0))
  const baseHourlyRate = dailyBase / Math.max(1, Number(input.standardMinutes || 480)) * 60
  const holidayOtMinutes = Math.max(0, Number(input.holidayOvertimeMinutes ?? approvedOt))
  const normalPay = input.isHoliday ? 0 : dayUnits * dailyBase
  const holidayPay = input.isHoliday ? dayUnits * dailyBase * multiplier : 0
  const normalOvertimePay = input.isHoliday ? 0 : approvedOt / 60 * normalOtRate
  const holidayOvertimePay = input.isHoliday ? holidayOtMinutes / 60 * baseHourlyRate * 3 : 0
  return {
    dayUnits,
    multiplier,
    normalPay,
    holidayPay,
    normalOvertimePay,
    holidayOvertimePay,
    netPay: normalPay + holidayPay + normalOvertimePay + holidayOvertimePay,
    needsHolidayReview: Boolean(input.isHoliday && dayUnits > 0 && input.multiplier == null),
  }
}
