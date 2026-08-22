import { registerClientError } from '../lib/telemetry'

const reported = new Map<string, number>()
const DEDUPE_MS = 2 * 60 * 1000

const clean = (value: unknown, max = 500) => String(value ?? '')
  .replace(/(access_token|refresh_token|authorization|password|secret|apikey|api_key)=?[^,\s&]*/gi, '$1=[redacted]')
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
  .slice(0, max)

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(16).padStart(8, '0')
}

const getMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return String(error ?? '')
  const record = error as Record<string, unknown>
  return [
    record.message,
    record.error,
    record.details,
    record.hint,
    record.statusText,
  ].find((part): part is string => typeof part === 'string' && part.trim().length > 0) ?? ''
}

const getCode = (error: unknown) => {
  if (error instanceof Error) return error.name || 'Error'
  if (!error || typeof error !== 'object') return 'UNKNOWN'
  const record = error as Record<string, unknown>
  return [
    record.error_code,
    record.code,
    record.status,
    record.name,
  ].find((part): part is string | number => (typeof part === 'string' && part.trim().length > 0) || typeof part === 'number') ?? 'UNKNOWN'
}

const isReportableError = (error: unknown) => {
  if (error instanceof Error) return true
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  if (record.context instanceof Response || record.response instanceof Response) return true
  if (typeof record.error === 'string') return true
  if (typeof record.code === 'string' && typeof record.message === 'string') return true
  if (typeof record.error_code === 'string') return true
  return false
}

export function reportCentralError(error: unknown, options?: {
  module?: string
  source?: string
  title?: string
  severity?: 'warning' | 'error' | 'critical'
}) {
  if (typeof window === 'undefined') return
  if (!isReportableError(error)) return
  const message = clean(getMessage(error) || 'Unknown application error')
  const code = clean(getCode(error), 80)
  const module = clean(options?.module || window.location.pathname || 'frontend', 160)
  const source = clean(options?.source || 'web:user-error', 80)
  const key = `${source}|${module}|${code}|${message}`.toLowerCase()
  const now = Date.now()
  const last = reported.get(key) ?? 0
  if (now - last < DEDUPE_MS) return
  reported.set(key, now)

  const fingerprint = `frontend:${hash(key)}`
  void registerClientError({
    fingerprint,
    correlationKey: key.slice(0, 300),
    source,
    title: options?.title || `Application error: ${module}`,
    message,
    module,
    severity: options?.severity ?? (/permission|forbidden|denied|rls|constraint|rate limit|banned/i.test(`${code} ${message}`) ? 'critical' : 'error'),
    metadata: {
      error_code: code,
      page_path: window.location.pathname,
    },
  })
}
