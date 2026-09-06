const INTERNAL_ORIGIN = 'https://wisdomai.local'

export function safeInternalReturnPath(requested: string | null | undefined) {
  if (!requested || !requested.startsWith('/') || requested.startsWith('//')) return null

  try {
    const decoded = decodeURIComponent(requested)
    const hasControlCharacter = [...decoded].some(character => character.charCodeAt(0) < 32)
    if (decoded.startsWith('//') || decoded.includes('\\') || hasControlCharacter) return null

    const url = new URL(requested, INTERNAL_ORIGIN)
    if (url.origin !== INTERNAL_ORIGIN) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}
