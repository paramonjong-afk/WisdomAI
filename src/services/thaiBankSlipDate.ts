const thaiMonths: Record<string, number> = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}

export const parseThaiBankSlipDate = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = /^(\d{1,2})\s+(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s+(\d{2,4})\D+(\d{1,2}):(\d{2})/.exec(text)
  if (!match) return null
  const buddhistYear = Number(match[3]) < 100 ? 2500 + Number(match[3]) : Number(match[3])
  const year = buddhistYear - 543
  const month = thaiMonths[match[2]]
  const day = Number(match[1]); const hour = Number(match[4]); const minute = Number(match[5])
  if (!month || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`
}
