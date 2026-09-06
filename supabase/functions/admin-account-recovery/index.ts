import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const siteUrl = (Deno.env.get('WISDOMAI_SITE_URL') ?? Deno.env.get('SITE_URL') ?? 'https://wisdomai.pages.dev').replace(/\/$/, '')
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type' }
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return out({ error: 'Method not allowed' }, 405)
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!bearer) return out({ error: 'Unauthorized' }, 401)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: auth } = await admin.auth.getUser(bearer)
  if (!auth.user) return out({ error: 'Unauthorized' }, 401)
  const { data: actor } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle()
  if (actor?.role !== 'admin') return out({ error: 'เฉพาะ Admin เท่านั้น', error_code: 'PERMISSION_DENIED' }, 403)
  const body = await request.json() as { action?: 'lookup' | 'unban' | 'send_reset'; userId?: string; email?: string; reason?: string }
  const targetId = body.userId?.trim()
  const email = body.email?.trim().toLowerCase()
  if (!targetId && !email) return out({ error: 'ต้องระบุ userId หรือ email' }, 400)
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) return out({ error: listError.message }, 400)
  const target = users.users.find((u) => (targetId && u.id === targetId) || (email && u.email?.toLowerCase() === email))
  if (!target) return out({ error: 'ไม่พบบัญชี' }, 404)
  if (body.action === 'lookup') return out({ ok: true, user: { id: target.id, email: target.email, banned_until: target.banned_until, last_sign_in_at: target.last_sign_in_at, is_banned: Boolean(target.banned_until && new Date(target.banned_until).getTime() > Date.now()) } })
  const reason = body.reason?.trim()
  if (!reason) return out({ error: 'กรุณาระบุเหตุผล', error_code: 'REASON_REQUIRED' }, 400)
  if (body.action === 'unban') {
    const { error } = await admin.auth.admin.updateUserById(target.id, { ban_duration: 'none' })
    if (error) return out({ error: error.message, error_code: 'AUTH_UNBAN_FAILED' }, 400)
  } else if (body.action === 'send_reset') {
    if (!target.email) return out({ error: 'บัญชีไม่มีอีเมล' }, 400)
    if (target.banned_until && new Date(target.banned_until).getTime() > Date.now()) {
      return out({ error: 'บัญชียังถูกระงับ กรุณายกเลิกการระงับและตรวจสอบสถานะก่อนส่งลิงก์', error_code: 'USER_STILL_BANNED' }, 409)
    }
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } })
    const { error } = await authClient.auth.resetPasswordForEmail(target.email, { redirectTo: `${siteUrl}/reset-password` })
    if (error) return out({ error: error.message, error_code: 'RESET_EMAIL_FAILED' }, 400)
  } else return out({ error: 'ไม่รู้จัก action' }, 400)
  const { error: auditError } = await admin.from('app_activity_logs').insert({ profile_id: auth.user.id, event_type: 'mutation_attempt', severity: 'info', message: body.action === 'unban' ? 'Admin ยกเลิกการระงับบัญชี' : 'Admin ส่งลิงก์ตั้งรหัสผ่านใหม่', metadata: { module: 'admin-account-recovery', target_user_id: target.id, reason, redirect_origin: siteUrl } })
  if (auditError) return out({ error: 'ดำเนินการสำเร็จแต่บันทึก Audit ไม่สำเร็จ กรุณาแจ้งผู้ดูแลระบบ', error_code: 'AUDIT_WRITE_FAILED' }, 500)
  return out({ ok: true, userId: target.id, action: body.action })
})
