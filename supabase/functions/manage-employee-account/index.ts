import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' }
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return out({ error: 'Method not allowed' }, 405)
  const authorization = request.headers.get('authorization')
  if (!authorization) return out({ error: 'Unauthorized' }, 401)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  const { data: auth } = await admin.auth.getUser(token)
  if (!auth.user) return out({ error: 'Unauthorized' }, 401)
  const { data: actor } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
  if (actor?.role !== 'admin') return out({ error: 'เฉพาะ Platform Admin เท่านั้นที่แก้บัญชีพนักงานได้', error_code: 'PERMISSION_DENIED' }, 403)
  const body = await request.json() as { profileId?: string; email?: string; password?: string }
  const email = body.email?.trim().toLowerCase() ?? ''
  if (!body.profileId || !email || !body.password) return out({ error: 'ข้อมูลไม่ครบ' }, 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return out({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }, 400)
  if (body.password.length < 10) return out({ error: 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร' }, 400)
  if (body.profileId === auth.user.id) return out({ error: 'กรุณาเปลี่ยนบัญชีของตนเองจากหน้าโปรไฟล์' }, 400)
  const { data: target } = await admin.from('profiles').select('id').eq('id', body.profileId).maybeSingle()
  if (!target) return out({ error: 'ไม่พบพนักงาน' }, 404)
  const { error: authError } = await admin.auth.admin.updateUserById(body.profileId, { email, password: body.password, email_confirm: true })
  if (authError) return out({ error: authError.message, error_code: 'AUTH_UPDATE_FAILED' }, 400)
  const { error: profileError } = await admin.from('profiles').update({ email, updated_at: new Date().toISOString() }).eq('id', body.profileId)
  if (profileError) return out({ error: profileError.message, error_code: 'PROFILE_UPDATE_FAILED' }, 400)
  await admin.from('app_activity_logs').insert({ profile_id: auth.user.id, event_type: 'mutation_attempt', severity: 'info', message: 'แก้ไขบัญชีเข้าสู่ระบบพนักงาน', metadata: { module: 'manage-employee-account', target_profile_id: body.profileId, email } })
  return out({ ok: true })
})
