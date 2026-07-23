import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { logAppEvent, updateAppStatus } from '../lib/telemetry'

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
    const handleError = (event: ErrorEvent) => {
      void logAppEvent(profileId, {
        eventType: 'client_error',
        severity: 'error',
        message: event.message,
        metadata: { source: event.filename || 'browser', line: event.lineno || 0 },
      })
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const message = event.reason instanceof Error ? event.reason.message : String(event.reason)
      void logAppEvent(profileId, {
        eventType: 'client_error',
        severity: 'error',
        message,
        metadata: { source: 'unhandledrejection' },
      })
    }
    const timer = window.setInterval(heartbeat, 60_000)
    document.addEventListener('visibilitychange', heartbeat)
    window.addEventListener('focus', heartbeat)
    window.addEventListener('online', heartbeat)
    window.addEventListener('offline', heartbeat)
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', heartbeat)
      window.removeEventListener('focus', heartbeat)
      window.removeEventListener('online', heartbeat)
      window.removeEventListener('offline', heartbeat)
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [user])

  return null
}
