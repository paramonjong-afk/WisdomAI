export type IntakeLineEvent = {
  type?: string
  webhookEventId?: string
  deliveryContext?: { isRedelivery?: boolean }
  source?: { type?: string; groupId?: string; roomId?: string }
  message?: { type?: string }
}

export type IntakeDescriptor = {
  fingerprint: string
  webhookEventId: string | null
  sourceType: string | null
  lineGroupId: string | null
  eventType: string | null
  messageType: string | null
  isRedelivery: boolean
}

export function describeLineWebhookEvent(event: IntakeLineEvent, bodySha256: string, index: number): IntakeDescriptor {
  const webhookEventId = typeof event.webhookEventId === 'string' && event.webhookEventId.trim()
    ? event.webhookEventId.trim()
    : null
  return {
    fingerprint: webhookEventId ? `event:${webhookEventId}` : `event:${bodySha256}:${index}`,
    webhookEventId,
    sourceType: typeof event.source?.type === 'string' ? event.source.type : null,
    lineGroupId: event.source?.groupId ?? event.source?.roomId ?? null,
    eventType: typeof event.type === 'string' ? event.type : null,
    messageType: typeof event.message?.type === 'string' ? event.message.type : null,
    isRedelivery: event.deliveryContext?.isRedelivery === true,
  }
}

export function safeWebhookEventList(payload: unknown): IntakeLineEvent[] | null {
  if (!payload || typeof payload !== 'object') return null
  const events = (payload as { events?: unknown }).events
  if (!Array.isArray(events)) return null
  return events.filter((event): event is IntakeLineEvent => Boolean(event) && typeof event === 'object')
}
