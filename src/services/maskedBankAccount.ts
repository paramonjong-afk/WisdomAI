export const visibleAccountTail = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : ''
  const maskedTail = /[xX*•]+\D*(\d{3,4})\s*$/.exec(raw)?.[1]
  if (maskedTail) return maskedTail
  const digits = raw.replace(/\D/g, '')
  if (digits.length >= 4) return digits.slice(-4)
  return digits.length === 3 ? digits : null
}

export const isVisibleAccountTail = (value: string) => /^\d{3,4}$/.test(value)
