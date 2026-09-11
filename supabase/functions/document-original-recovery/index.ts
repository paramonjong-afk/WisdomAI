import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' }
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return out({ error: 'Method not allowed' }, 405)
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return out({ error: 'Unauthorized' }, 401)
  const body = await request.json().catch(() => ({})) as { grantId?: string }
  if (!body.grantId) return out({ error: 'grantId is required', error_code: 'GRANT_ID_REQUIRED' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: auth } = await admin.auth.getUser(bearer)
  if (!auth.user) return out({ error: 'Unauthorized' }, 401)
  const scoped = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  })
  const { data: grant, error: grantError } = await scoped.from('document_original_recovery_grants')
    .select('id,company_id,status,storage_bucket,storage_path,content_sha256,expires_at')
    .eq('id', body.grantId).maybeSingle()
  if (grantError || !grant) return out({ error: 'Recovery grant not found', error_code: 'GRANT_NOT_FOUND' }, 404)
  if (grant.status !== 'approved' || new Date(grant.expires_at).getTime() <= Date.now()) {
    return out({ error: 'Recovery grant is not active', error_code: 'GRANT_NOT_ACTIVE' }, 409)
  }
  if (!grant.content_sha256) return out({ error: 'Original has no integrity hash', error_code: 'INTEGRITY_HASH_MISSING' }, 409)

  const { data: source, error: downloadError } = await admin.storage.from(grant.storage_bucket).download(grant.storage_path)
  if (downloadError || !source) return out({ error: 'Original could not be read', error_code: 'ORIGINAL_READ_FAILED' }, 502)
  const actualHash = hex(await crypto.subtle.digest('SHA-256', await source.arrayBuffer()))
  if (actualHash.toLowerCase() !== grant.content_sha256.toLowerCase()) {
    const { error: mismatchAuditError } = await admin.from('document_original_recovery_audit').upsert({
      company_id: grant.company_id, grant_id: grant.id, event_key: 'hash_mismatch', actor_id: auth.user.id,
      event_data: { expected_sha256: grant.content_sha256, actual_sha256: actualHash },
    }, { onConflict: 'grant_id,event_key', ignoreDuplicates: true })
    if (mismatchAuditError) return out({ error: 'Integrity failure could not be audited', error_code: 'AUDIT_WRITE_FAILED' }, 500)
    return out({ error: 'Original integrity verification failed', error_code: 'HASH_MISMATCH' }, 409)
  }
  const { error: verifiedAuditError } = await admin.from('document_original_recovery_audit').upsert({
    company_id: grant.company_id, grant_id: grant.id, event_key: 'hash_verified', actor_id: auth.user.id,
    event_data: { content_sha256: actualHash },
  }, { onConflict: 'grant_id,event_key', ignoreDuplicates: true })
  if (verifiedAuditError) return out({ error: 'Integrity verification could not be audited', error_code: 'AUDIT_WRITE_FAILED' }, 500)

  const seconds = Math.max(1, Math.min(900, Math.floor((new Date(grant.expires_at).getTime() - Date.now()) / 1000)))
  const { data: signed, error: signedError } = await admin.storage.from(grant.storage_bucket).createSignedUrl(grant.storage_path, seconds)
  if (signedError || !signed?.signedUrl) return out({ error: 'Temporary access could not be created', error_code: 'SIGNED_URL_FAILED' }, 502)
  const { data: consumed, error: consumeError } = await scoped.rpc('consume_document_original_recovery', { target_grant_id: grant.id })
  if (consumeError || !consumed?.length) return out({ error: 'Recovery grant was already consumed', error_code: 'GRANT_CONSUME_CONFLICT' }, 409)
  return out({ ok: true, signed_url: signed.signedUrl, expires_at: grant.expires_at, content_sha256: actualHash })
})
