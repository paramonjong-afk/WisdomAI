import { createClient } from 'npm:@supabase/supabase-js@2'

type CreateEmployeeBody = {
  email?: string
  password?: string
  fullName?: string
  role?: 'employee' | 'manager'
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
    })
    const admin = createClient(url, serviceKey)
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) {
      return Response.json({ error: 'กรุณาเข้าสู่ระบบใหม่' }, { status: 401, headers: cors })
    }

    const { data: actorProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .single()
    if (actorProfile?.role !== 'admin') {
      return Response.json({ error: 'เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานได้' }, { status: 403, headers: cors })
    }

    const body = await request.json() as CreateEmployeeBody
    const email = body.email?.trim().toLowerCase() ?? ''
    const password = body.password ?? ''
    const fullName = body.fullName?.trim() ?? ''
    const role = body.role === 'manager' ? 'manager' : 'employee'

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง')
    if (fullName.length < 2 || fullName.length > 120) throw new Error('กรุณาระบุชื่อพนักงาน 2-120 ตัวอักษร')
    if (password.length < 10) throw new Error('รหัสผ่านชั่วคราวต้องมีอย่างน้อย 10 ตัวอักษร')

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message)
      throw new Error(duplicate ? 'อีเมลนี้มีบัญชีอยู่แล้ว' : createError.message)
    }
    if (!created.user) throw new Error('ไม่สามารถสร้างบัญชีพนักงานได้')

    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      full_name: fullName,
      email,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw profileError
    }

    return Response.json({
      ok: true,
      employee: { id: created.user.id, email, full_name: fullName, role },
    }, { headers: cors })
  } catch (error) {
    console.error(error)
    return Response.json({
      error: error instanceof Error ? error.message : 'ไม่สามารถเพิ่มพนักงานได้',
    }, { status: 400, headers: cors })
  }
})
