export type AdvanceAuditEvent = {
  id: string
  action: string
  reason: string | null
  created_at: string
}

export type AdvanceAuditTimelineEvent = AdvanceAuditEvent & {
  attempt: number
  totalAttempts: number
  retryNumber: number | null
}

const RETRYABLE_CONFIRMATION_ACTIONS = new Set([
  'confirmation_room_setup',
  'confirmation_queued',
  'confirmation_delivery_failed',
  'confirmation_delivered',
])

export function buildAdvanceAuditTimeline(audits: AdvanceAuditEvent[]): AdvanceAuditTimelineEvent[] {
  const sorted = [...audits].sort((left, right) => left.created_at.localeCompare(right.created_at))
  const totals = sorted.reduce<Record<string, number>>((result, audit) => {
    if (RETRYABLE_CONFIRMATION_ACTIONS.has(audit.action)) result[audit.action] = (result[audit.action] ?? 0) + 1
    return result
  }, {})
  const attempts: Record<string, number> = {}

  return sorted.map((audit) => {
    if (!RETRYABLE_CONFIRMATION_ACTIONS.has(audit.action)) {
      return { ...audit, attempt: 1, totalAttempts: 1, retryNumber: null }
    }

    const attempt = (attempts[audit.action] ?? 0) + 1
    attempts[audit.action] = attempt
    return {
      ...audit,
      attempt,
      totalAttempts: totals[audit.action] ?? 1,
      retryNumber: attempt > 1 ? attempt - 1 : null,
    }
  })
}

export function advanceAuditAttemptLabel(audit: AdvanceAuditTimelineEvent) {
  if (audit.totalAttempts <= 1) return null
  return audit.retryNumber === null
    ? `ครั้งแรก · รวม ${audit.totalAttempts} ครั้ง`
    : `Retry #${audit.retryNumber} · ครั้งที่ ${audit.attempt}/${audit.totalAttempts}`
}
