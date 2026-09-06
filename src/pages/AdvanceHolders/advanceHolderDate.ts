const MIN_ACTIVITY_YEAR = 2020

export function formatAdvanceHolderDate(value: string | null | undefined, now = new Date()) {
  if (!value) return '-'
  const parsed = new Date(value)
  const year = parsed.getUTCFullYear()
  const currentYear = now.getUTCFullYear()
  if (Number.isNaN(parsed.getTime()) || year < MIN_ACTIVITY_YEAR || year > currentYear + 1) return 'วันที่ผิดปกติ'
  return parsed.toLocaleString('th-TH')
}
