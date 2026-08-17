export type WorkTimeDisplaySettings = {
  work_time_primary_unit: 'days' | 'hours'
  work_time_day_decimals: number
  work_time_show_secondary_hours: boolean
  full_day_minutes: number
  half_day_minutes: number
}

export const defaultWorkTimeDisplaySettings: WorkTimeDisplaySettings = {
  work_time_primary_unit: 'days',
  work_time_day_decimals: 2,
  work_time_show_secondary_hours: true,
  full_day_minutes: 480,
  half_day_minutes: 240,
}

export function formatHoursMinutes(minutes: number | null | undefined) {
  const value = Math.max(0, Math.round(Number(minutes ?? 0)))
  const hours = Math.floor(value / 60)
  const remaining = value % 60
  if (hours && remaining) return `${hours} ชม. ${remaining} นาที`
  if (hours) return `${hours} ชม.`
  return `${remaining} นาที`
}

export function formatWorkTime(
  minutes: number | null | undefined,
  settings: WorkTimeDisplaySettings,
  empty = '-',
) {
  const value = Math.max(0, Number(minutes ?? 0))
  if (!value) return { primary: empty, secondary: '' }
  if (settings.work_time_primary_unit === 'hours') {
    return { primary: formatHoursMinutes(value), secondary: '' }
  }
  const divisor = Math.max(1, Number(settings.full_day_minutes) || 480)
  const decimals = Math.min(3, Math.max(0, Number(settings.work_time_day_decimals) || 0))
  const days = value / divisor
  return {
    primary: `${days.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} วัน`,
    secondary: settings.work_time_show_secondary_hours ? formatHoursMinutes(value) : '',
  }
}
