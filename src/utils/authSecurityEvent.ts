import { supabase } from '../lib/supabase'

type AuthSecuritySeverity = 'warning' | 'critical'

const normalizeReason = (reason: unknown) => {
  if (reason instanceof Error) return reason.message
  if (reason && typeof reason === 'object') {
    const value = reason as Record<string, unknown>
    return [value.code, value.message, value.error, value.error_description]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' | ') || 'unknown_auth_error'
  }
  return String(reason || 'unknown_auth_error')
}

export async function registerAuthSecurityEvent({
  email,
  eventType,
  reason,
  severity = 'warning',
}: {
  email?: string | null
  eventType: string
  reason: unknown
  severity?: AuthSecuritySeverity
}) {
  const normalizedEmail = email?.trim() || 'unknown'
  const normalizedReason = normalizeReason(reason).slice(0, 90)
  await supabase.rpc('register_login_attempt', {
    target_email: normalizedEmail,
    target_outcome: 'failure',
    target_reason: `auth_${severity}:${eventType}:${normalizedReason}`.slice(0, 120),
    target_user_agent: navigator.userAgent,
  })
}
