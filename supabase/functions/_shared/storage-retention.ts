export type RetentionAction = 'dry_run' | 'trash' | 'restore' | 'purge'

export const DEFAULT_BATCH_LIMIT = 25
export const MAX_BATCH_LIMIT = 100

export function normalizeBatchLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_LIMIT
  return Math.min(MAX_BATCH_LIMIT, Math.max(1, Math.trunc(parsed)))
}

export function trashPath(blobId: string, originalPath: string): string {
  const name = originalPath.split('/').pop() || 'object'
  return `.trash/${blobId}/${name}`
}

export function isRetentionAction(value: unknown): value is RetentionAction {
  return value === 'dry_run' || value === 'trash' || value === 'restore' || value === 'purge'
}
