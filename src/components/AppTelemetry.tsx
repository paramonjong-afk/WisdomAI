import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, registerClientError, updateAppStatus } from '../lib/telemetry'

export function AppTelemetry() {
  const { user } = useAuth()
  const location = useLocation()
  const startedFor = useRef('')

  useEffect(() => {
    if (!user) return
    const profileId = user.id
    const path = location.pathname
    if (startedFor.current !== profileId) {
      startedFor.current = profileId
      void logAppEvent(profileId, { eventType: 'session_start', pagePath: path })
    }
    void logAppEvent(profileId, { eventType: 'page_view', pagePath: path })
    void updateAppStatus(profileId, document.hidden ? 'away' : 'online', path)
  }, [location.pathname, user])

  useEffect(() => {
    if (!user) return
    const profileId = user.id
    const heartbeat = () => void updateAppStatus(
      profileId,
      document.hidden || !navigator.onLine ? 'away' : 'online',
      window.location.pathname,
    )
    const normalizeError = (message: string) => message
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
      .replace(/\b\d{4,}\b/g, ':number')
      .slice(0, 500)
    const fingerprint = (source: string, message: string) => {
      const value = `${source}|${window.location.pathname}|${normalizeError(message)}`
      let hash = 2166136261
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return `frontend:${(hash >>> 0).toString(16).padStart(8, '0')}`
    }
    const correlationKey = (module: string, code: string, message: string) =>
      `${module}|${code}|${normalizeError(message)}`.toLowerCase().slice(0, 300)
    const isExpectedRequestOutcome = (path: string, status: number) => {
      const normalizedPath = path.split('?')[0].toLowerCase()
      return normalizedPath.includes('/auth/v1/token') && (status === 400 || status === 401)
    }
    const persistError = (source: string, message: string, module: string, code: string, metadata: Record<string, string | number>) => {
      const errorFingerprint = fingerprint(source, message)
      void logAppEvent(profileId, {
        eventType: source === 'request' ? 'request_error' : 'client_error', severity: 'error', message,
        pagePath: window.location.pathname, metadata: { ...metadata, source, fingerprint: errorFingerprint },
      })
      void registerClientError({
        fingerprint: errorFingerprint, correlationKey: correlationKey(module, code, message), source: `web:${source}`,
        title: `Web error: ${module}`, message, module, metadata: { ...metadata, error_code: code, page_path: window.location.pathname },
      })
    }
    const handleError = (event: ErrorEvent) => {
      const source = event.filename || 'browser'
      const message = normalizeError(event.message || 'Unknown browser error')
      persistError(source, message, 'frontend', event.error?.name || 'browser_error', { line: event.lineno || 0, column: event.colno || 0 })
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const message = normalizeError(event.reason instanceof Error ? event.reason.message : String(event.reason))
      persistError('unhandledrejection', message, 'frontend', 'unhandled_rejection', {})
    }
    const handleRequestError = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; status?: number; statusText?: string }>).detail ?? {}
      const path = detail.path || 'unknown-request'
      const status = Number(detail.status || 0)
      // Invalid/expired login credentials are an expected Auth response, not a system outage.
      if (isExpectedRequestOutcome(path, status)) return
      const message = `${status || 'NETWORK'} ${detail.statusText || 'Request failed'} at ${path}`
      persistError('request', message, path, `http_${status || 'network'}`, { status, request_path: path })
    }
    const timer = window.setInterval(heartbeat, 60_000)
    document.addEventListener('visibilitychange', heartbeat)
    window.addEventListener('focus', heartbeat)
    window.addEventListener('online', heartbeat)
    window.addEventListener('offline', heartbeat)
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    window.addEventListener('wisdomai-request-error', handleRequestError)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', heartbeat)
      window.removeEventListener('focus', heartbeat)
      window.removeEventListener('online', heartbeat)
      window.removeEventListener('offline', heartbeat)
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
      window.removeEventListener('wisdomai-request-error', handleRequestError)
    }
  }, [user])

  return null
}
