import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { inspectDocumentSecurity } from '../_shared/document-security.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'unauthorized' }, 401)
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401)
  const form = await request.formData()
  const file = form.get('file')
  const companyId = String(form.get('company_id') ?? '')
  const roomId = String(form.get('room_id') ?? '')
  if (!(file instanceof File) || !companyId || !roomId) return json({ error: 'invalid_request' }, 400)
  const { data: membership } = await admin.from('company_members').select('profile_id').eq('company_id', companyId).eq('profile_id', authData.user.id).eq('active', true).or('ends_on.is.null,ends_on.gte.' + new Date().toISOString().slice(0, 10)).maybeSingle()
  if (!membership) return json({ error: 'company_membership_required' }, 403)
  const { data: room } = await admin.from('chat_rooms').select('id, company_id').eq('id', roomId).eq('company_id', companyId).maybeSingle()
  if (!room) return json({ error: 'room_not_found' }, 404)
  const { data: roomMember } = await admin.from('chat_room_members').select('room_id').eq('room_id', roomId).eq('profile_id', authData.user.id).maybeSingle()
  if (!roomMember) return json({ error: 'room_membership_required' }, 403)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const security = inspectDocumentSecurity(bytes, file.type)
  if (!security.accepted) return json({ error: 'security_rejected', reason: security.reason }, 422)
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-180) || 'attachment'
  const objectPath = `${companyId}/${roomId}/${Date.now()}-${crypto.randomUUID()}-${sanitized}`
  const { error: uploadError } = await admin.storage.from('chat-attachments').upload(objectPath, bytes, { cacheControl: '3600', upsert: false, contentType: file.type })
  if (uploadError) return json({ error: 'storage_upload_failed' }, 502)
  const { data: message, error: messageError } = await admin.from('chat_messages').insert({ company_id: companyId, room_id: roomId, sender_profile_id: authData.user.id, message_type: 'file', attachment_bucket: 'chat-attachments', attachment_path: objectPath, attachment_name: sanitized, attachment_content_type: file.type, attachment_size: bytes.byteLength }).select('id, attachment_path').single()
  if (messageError) { await admin.storage.from('chat-attachments').remove([objectPath]); return json({ error: 'message_write_failed' }, 502) }
  return json({ message })
})
