import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isRetentionAction, normalizeBatchLimit, trashPath } from '../_shared/storage-retention.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
const expectedSecret = Deno.env.get('STORAGE_RETENTION_WORKER_SECRET')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Candidate = { id:string; storage_bucket:string; storage_path:string; trash_storage_path:string|null; size_bytes:number; lifecycle_state:'active'|'trash' }
type Body = { action?:unknown; batch_limit?:unknown; blob_id?:unknown }

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!expectedSecret) return json({ error: 'worker_not_configured' }, 503)
  if (request.headers.get('x-storage-retention-secret') !== expectedSecret) return json({ error: 'unauthorized' }, 401)
  const body = await request.json().catch(() => ({})) as Body
  if (!isRetentionAction(body.action)) return json({ error: 'invalid_action' }, 400)
  const batchLimit = normalizeBatchLimit(body.batch_limit)
  const blobId = typeof body.blob_id === 'string' ? body.blob_id : null
  if (body.action === 'restore' && !blobId) return json({ error: 'blob_id_required' }, 400)

  const { data, error } = await admin.rpc('storage_retention_candidates', {
    target_action: body.action, target_limit: batchLimit, target_blob_id: blobId,
  })
  if (error) return json({ error: error.message }, 500)
  const candidates = (data ?? []) as Candidate[]
  if (body.action === 'dry_run') {
    return json({ action: body.action, dry_run: true, candidates: candidates.length, bytes_reclaimable: candidates.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0), batch_limit: batchLimit })
  }

  let processed = 0, skipped = 0, bytesReclaimed = 0
  const failures: Array<{id:string; error:string}> = []
  for (const candidate of candidates) {
    try {
      const bucket = admin.storage.from(candidate.storage_bucket)
      if (body.action === 'trash') {
        const destination = trashPath(candidate.id, candidate.storage_path)
        const moved = await bucket.move(candidate.storage_path, destination)
        if (moved.error) throw moved.error
        const recorded = await admin.rpc('record_storage_retention_action', { target_blob_id:candidate.id, target_action:'trash', target_trash_path:destination, target_bytes:0 })
        if (recorded.error) { await bucket.move(destination, candidate.storage_path); throw recorded.error }
        processed += Number(recorded.data === true)
        skipped += Number(recorded.data !== true)
      } else if (body.action === 'restore') {
        if (!candidate.trash_storage_path) throw new Error('trash_path_missing')
        const moved = await bucket.move(candidate.trash_storage_path, candidate.storage_path)
        if (moved.error) throw moved.error
        const recorded = await admin.rpc('record_storage_retention_action', { target_blob_id:candidate.id, target_action:'restore', target_trash_path:null, target_bytes:0 })
        if (recorded.error) { await bucket.move(candidate.storage_path, candidate.trash_storage_path); throw recorded.error }
        processed += Number(recorded.data === true)
        skipped += Number(recorded.data !== true)
      } else {
        if (!candidate.trash_storage_path) throw new Error('trash_path_missing')
        const removed = await bucket.remove([candidate.trash_storage_path])
        if (removed.error) throw removed.error
        const recorded = await admin.rpc('record_storage_retention_action', { target_blob_id:candidate.id, target_action:'purge', target_trash_path:candidate.trash_storage_path, target_bytes:candidate.size_bytes })
        if (recorded.error) throw recorded.error
        const counted = recorded.data === true
        processed += Number(counted); skipped += Number(!counted)
        if (counted) bytesReclaimed += Number(candidate.size_bytes || 0)
      }
    } catch (cause) {
      failures.push({ id:candidate.id, error:cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return json({ action:body.action, processed, skipped, failed:failures.length, failures, bytes_reclaimed:bytesReclaimed, batch_limit:batchLimit })
})
