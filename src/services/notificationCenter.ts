import { supabase } from '../lib/supabase'

export type NotificationPriority = 'urgent' | 'review' | 'info' | 'success'
export type NotificationKind = 'actionable' | 'informational'
export type NotificationFilter = 'all' | 'unread' | 'actionable' | 'system'

export type CenterNotification = {
  id: string
  type: string
  module: string
  title: string
  detail: string
  owner: string
  slaAt: string | null
  occurredAt: string
  priority: NotificationPriority
  kind: NotificationKind
  read: boolean
  overdue: boolean
  path: string
  source: string
  referenceId: string | null
}

export type NotificationSnapshot = {
  items: CenterNotification[]
  unreadCount: number
  actionableCount: number
  lastUpdated: string
  warning: string | null
}

type Row = Record<string, unknown>
const stringValue = (row: Row, key: string) => typeof row[key] === 'string' ? row[key] as string : ''
const asRows = (data: unknown) => Array.isArray(data) ? data as Row[] : []
const actionableEventTypes = new Set(['incident', 'repeat', 'approval_required', 'review_required'])

const eventToNotification = (row: Row, readKeys: Set<string>): CenterNotification => {
  const status = stringValue(row, 'status').toLowerCase()
  const error = stringValue(row, 'error_message')
  const eventType = stringValue(row, 'event_type') || 'system_event'
  const actionable = Boolean(actionableEventTypes.has(eventType) || error || ['failed', 'pending', 'queued', 'review', 'blocked'].some((value) => status.includes(value)))
  const priority: NotificationPriority = error || eventType === 'incident' || status.includes('failed') ? 'urgent' : actionable ? 'review' : status.includes('success') || status.includes('done') || status.includes('completed') ? 'success' : 'info'
  return {
    id: stringValue(row, 'event_id'), type: eventType, module: stringValue(row, 'source_type') || 'System', title: stringValue(row, 'title') || eventType,
    detail: stringValue(row, 'message') || error || status, owner: stringValue(row, 'related_work_key') || 'ระบบ', slaAt: null,
    occurredAt: stringValue(row, 'occurred_at') || new Date().toISOString(), priority, kind: actionable ? 'actionable' : 'informational',
    read: readKeys.has(stringValue(row, 'event_id')), overdue: false, path: stringValue(row, 'related_work_key') ? '/work-command-center' : '/system-health',
    source: stringValue(row, 'source_type'), referenceId: stringValue(row, 'source_id') || null,
  }
}

export async function loadNotificationSnapshot(options: { companyId: string; profileId: string }): Promise<NotificationSnapshot> {
  const [feedResult, readResult] = await Promise.all([
    supabase.rpc('get_communication_event_feed', { target_company_id: options.companyId, target_limit: 100 }),
    supabase.from('notification_read_states').select('notification_key').eq('profile_id', options.profileId),
  ])
  if (feedResult.error) throw feedResult.error
  const readKeys = new Set(asRows(readResult.data).map((row) => stringValue(row, 'notification_key')))
  const items = asRows(feedResult.data).map((row) => eventToNotification(row, readKeys))
  return { items, unreadCount: items.filter((item) => !item.read).length, actionableCount: items.filter((item) => item.kind === 'actionable').length, lastUpdated: new Date().toISOString(), warning: readResult.error ? 'อ่านสถานะอ่านแล้วไม่สำเร็จ' : null }
}
