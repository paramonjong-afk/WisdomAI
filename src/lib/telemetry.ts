import { supabase } from './supabase'

export type ActivityEventType =
  | 'session_start'
  | 'session_end'
  | 'page_view'
  | 'client_error'
  | 'request_error'

export type ActivitySeverity = 'info' | 'warning' | 'error'

const DEVICE_ID_KEY = 'wisdomai-device-id'

function getDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY)
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, deviceId)
  }
  return deviceId
}

function getDeviceLabel() {
  const userAgent = navigator.userAgent
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS/i.test(userAgent)
          ? 'macOS'
          : 'อุปกรณ์อื่น'
  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /Chrome\//i.test(userAgent)
      ? 'Chrome'
      : /Safari\//i.test(userAgent)
        ? 'Safari'
        : /Firefox\//i.test(userAgent)
          ? 'Firefox'
          : 'Browser'
  return `${os} · ${browser}`
}

function safeMessage(message?: string) {
  return message?.replace(/(token|password|secret|authorization)[^,\s]*/gi, '[redacted]').slice(0, 500) || null
}

export async function logAppEvent(
  profileId: string,
  event: {
    eventType: ActivityEventType
    severity?: ActivitySeverity
    pagePath?: string
    message?: string
    metadata?: Record<string, string | number | boolean | null>
  },
) {
  const { error } = await supabase.from('app_activity_logs').insert({
    profile_id: profileId,
    event_type: event.eventType,
    severity: event.severity ?? 'info',
    page_path: (event.pagePath ?? window.location.pathname).slice(0, 300),
    message: safeMessage(event.message),
    device_id: getDeviceId(),
    device_label: getDeviceLabel(),
    metadata: event.metadata ?? {},
  })
  if (error) console.warn('Unable to save application activity.', error.message)
}

export async function updateAppStatus(
  profileId: string,
  status: 'online' | 'away' | 'offline',
  currentPath = window.location.pathname,
) {
  const { error } = await supabase.from('user_app_status').upsert({
    profile_id: profileId,
    device_id: getDeviceId(),
    status,
    current_path: currentPath.slice(0, 300),
    device_label: getDeviceLabel(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,device_id' })
  if (error) console.warn('Unable to update application status.', error.message)
}

