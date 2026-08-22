import { supabase } from '../lib/supabase'

export type AttemptStatus = 'pending' | 'success' | 'error'

export type IssueSeverity = 'info' | 'warning' | 'error'

export type OperationIssue = {
  code: string
  field?: string
  message: string
  blocking: boolean
  severity: IssueSeverity
  action?: string
}

export type PreflightResult = {
  status: 'valid' | 'invalid'
  issues: OperationIssue[]
  blockingIssues: OperationIssue[]
  canProceed: boolean
  signature: string
}

export type OperationAttemptRecord<TInput extends Record<string, unknown> = Record<string, unknown>> = {
  id: string
  module: string
  action: string
  status: AttemptStatus
  actor_profile_id: string
  company_id: string | null
  input: TInput
  created_at: string
  request_id?: string
  error_code?: string
  error?: string
  error_action?: string
  signature?: string
}

type PersistAttemptInput = OperationAttemptRecord<Record<string, unknown>>

const sanitizeForMetadata = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeForMetadata(item))

  if (typeof value === 'object') {
    const raw = value as Record<string, unknown>
    const masked: Record<string, unknown> = {}
    Object.entries(raw).forEach(([key, itemValue]) => {
      if (['password', 'token', 'secret', 'authorization'].includes(key.toLowerCase())) {
        masked[key] = '[redacted]'
      } else {
        masked[key] = sanitizeForMetadata(itemValue)
      }
    })
    return masked
  }

  return String(value)
}

const persistToCentralLog = (entry: PersistAttemptInput): void => {
  if (typeof window === 'undefined') return
  const sanitizedInput = sanitizeForMetadata(entry.input)
  void (async () => {
    try {
      await (supabase.rpc('register_mutation_attempt', {
        p_attempt_id: entry.id,
        p_module: entry.module,
        p_action: entry.action,
        p_status: entry.status,
        p_actor_profile_id: entry.actor_profile_id,
        p_company_id: entry.company_id,
        p_request_id: entry.request_id ?? null,
        p_error_code: entry.error_code ?? null,
        p_error: entry.error ?? null,
        p_error_action: entry.error_action ?? null,
        p_signature: entry.signature ?? null,
        p_input: sanitizedInput as never,
      }) as unknown as Promise<unknown>)
    } catch {
      void supabase.from('app_activity_logs').insert({
        profile_id: entry.actor_profile_id,
        event_type: 'mutation_attempt',
        severity: entry.status === 'success' ? 'info' : entry.status === 'pending' ? 'warning' : 'error',
        page_path: window.location.pathname,
        message: `${entry.module} / ${entry.action}`,
        metadata: {
          module: entry.module,
          action: entry.action,
          attempt_id: entry.id,
          mutation_status: entry.status,
          company_id: entry.company_id,
          request_id: entry.request_id,
          error_code: entry.error_code,
          error: entry.error,
          error_action: entry.error_action,
          signature: entry.signature,
          input: sanitizedInput,
        },
      } as never)
    }
  })
}

const defaultMaxAttempts = 30

const getItem = (key: string): OperationAttemptRecord[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const setItem = (key: string, records: OperationAttemptRecord[], max = defaultMaxAttempts) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(records.slice(-max)))
  } catch {
    // ignore persistence failure
  }
}

export const generateAttemptId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const createSignature = (input: Record<string, unknown>) => {
  const normalized = Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !['password', 'token', 'secret'].includes(key.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return btoa(unescape(encodeURIComponent(JSON.stringify(normalized))))
}

export const createAttemptStore = <TInput extends Record<string, unknown>>(key: string, maxItems = defaultMaxAttempts) => {
  const read = () => getItem(key) as OperationAttemptRecord<TInput>[]
  const write = (records: OperationAttemptRecord<TInput>[]) => setItem(key, records, maxItems)
  const upsert = (entry: OperationAttemptRecord<TInput>) => {
    const records = read().filter((item) => item.id !== entry.id)
    persistToCentralLog(entry)
    write([...records, entry])
  }
  return { read, write, upsert }
}

export const globalMutationAttemptStore = createAttemptStore<Record<string, unknown>>('global-mutation-attempts', 120)

export const summarizePreflight = (issues: OperationIssue[]) =>
  issues
    .map((issue) => `${issue.field ? `[${issue.field}] ` : ''}${issue.message}${issue.action ? ` | ${issue.action}` : ''}`)
    .join(' | ')

export const toPreflightResult = (input: { canProceed: boolean; issues: OperationIssue[]; signature: string }): PreflightResult => ({
  status: input.canProceed ? 'valid' : 'invalid',
  issues: input.issues,
  blockingIssues: input.issues.filter((issue) => issue.blocking),
  canProceed: input.canProceed,
  signature: input.signature,
})
