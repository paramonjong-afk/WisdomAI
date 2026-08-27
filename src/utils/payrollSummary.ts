export type PayableSession = {
  clock_in_at: string
  clock_out_at: string | null
  status: string
  worked_minutes: number | null
  excluded_minutes?: number | null
}

export type PayableDayOverride = {
  profile_id: string
  work_date: string
  day_units: number
}

const bangkokDate = (value: string) => new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

export function calculateSummaryDailyUnits(
  profileId: string,
  sessions: PayableSession[],
  overrides: PayableDayOverride[],
  standardMinutes: number,
) {
  const valid = sessions.filter((row) => row.clock_out_at && !['pending', 'needs_review'].includes(row.status))
  const dates = [...new Set(valid.map((row) => bangkokDate(row.clock_in_at)))]

  return dates.reduce((sum, date) => {
    const override = overrides.find((item) => item.profile_id === profileId && item.work_date === date)
    if (override) return sum + Number(override.day_units)

    const workedMinutes = valid
      .filter((row) => bangkokDate(row.clock_in_at) === date)
      .reduce((total, row) => {
        const elapsedMinutes = row.clock_out_at
          ? Math.max(0, Math.round((new Date(row.clock_out_at).getTime() - new Date(row.clock_in_at).getTime()) / 60000))
          : Number(row.worked_minutes ?? 0)
        return total + Math.max(0, elapsedMinutes - Number(row.excluded_minutes ?? 0))
      }, 0)
    return sum + (workedMinutes >= standardMinutes ? 1 : workedMinutes >= standardMinutes / 2 ? 0.5 : 0)
  }, 0)
}
