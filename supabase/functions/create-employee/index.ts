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

type ErrorResponse = {
  error: string
  error_code: string
  action: string
}

const makeError = (error: string, error_code: string, action: string): ErrorResponse => ({
  error,
  error_code,
  action,
})

const sendError = (error: ErrorResponse, status = 400) =>
  Response.json(error, { status, headers: { ...cors, 'content-type': 'application/json' } })

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
      return sendError(makeError(
        'กรุณาเข้าสู่ระบบใหม่',
        'AUTH_REQUIRED',
        'ออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้งเพื่อขอ token ใหม่',
      ), 401)
    }

    const { data: preference } = await admin.from('user_company_preferences')
      .select('active_company_id').eq('profile_id', authData.user.id).maybeSingle()
    let companyId = preference?.active_company_id ?? null
    if (!companyId) {
      const { data: fallback } = await admin.from('company_members')
        .select('company_id').eq('profile_id', authData.user.id).eq('active', true)
        .order('created_at').limit(1).maybeSingle()
      companyId = fallback?.company_id ?? null
    }
    const { data: actorMembership } = companyId
      ? await admin.from('company_members').select('company_role,active,ends_on')
        .eq('company_id', companyId).eq('profile_id', authData.user.id).maybeSingle()
      : { data: null }
    const expired = actorMembership?.ends_on && actorMembership.ends_on < new Date().toISOString().slice(0, 10)
    if (!companyId || !actorMembership?.active || expired || !['company_admin', 'executive', 'manager'].includes(actorMembership.company_role)) {
      return sendError(makeError(
        'เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานได้',
        'PERMISSION_DENIED',
        actorMembership?.active === false || expired
          ? 'ตรวจสถานะเป็นสมาชิกของบริษัทในหน้าบริษัทว่ากำลังใช้งานอยู่ และยังไม่หมดอายุ'
          : 'เปิดหน้าเลือกบริษัทให้ตรงกับบริษัทที่สังกัดก่อน แล้วให้สิทธิ์ผู้ใช้งานเป็น Admin/Manager/Executive',
      ), 403)
    }

    const body = await request.json() as CreateEmployeeBody
    const email = body.email?.trim().toLowerCase() ?? ''
    const password = body.password ?? ''
    const fullName = body.fullName?.trim() ?? ''
    const role = body.role === 'manager' ? 'manager' : 'employee'

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendError(makeError(
        'รูปแบบอีเมลไม่ถูกต้อง',
        'INVALID_EMAIL',
        'กรุณาใส่อีเมลให้ครบ เช่น name@domain.com',
      ))
    }
    if (fullName.length < 2 || fullName.length > 120) {
      return sendError(makeError(
        'กรุณาระบุชื่อพนักงาน 2-120 ตัวอักษร',
        'INVALID_NAME',
        'กรุณาแก้ชื่อพนักงานให้ยาวอย่างน้อย 2 ตัวอักษรไม่เกิน 120 ตัวอักษร',
      ))
    }
    if (password.length < 10) {
      return sendError(makeError(
        'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 10 ตัวอักษร',
        'INVALID_PASSWORD',
        'เพิ่มความยาวรหัสผ่านชั่วคราวเป็น 10 ตัวขึ้นไป',
      ))
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message)
      if (duplicate) {
        return sendError(makeError(
          'อีเมลนี้มีบัญชีอยู่แล้ว',
          'EMAIL_ALREADY_EXISTS',
          'เปลี่ยนอีเมลใหม่ หรือให้ทีม IT ปิดบัญชีเดิมก่อนลองใหม่อีกครั้ง',
        ), 409)
      }
      return sendError(makeError(
        createError.message,
        'AUTH_CREATE_FAILED',
        'ตรวจสอบสิทธิ์การสร้างบัญชีในระบบ Auth และลองใหม่อีกครั้ง',
      ))
    }
    if (!created.user) throw new Error('ไม่สามารถสร้างบัญชีพนักงานได้')

    const { error: profileError } = await admin.from('profiles').upsert({
      id: created.user.id,
      full_name: fullName,
      email,
      role: 'employee',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id)
      throw profileError
    }

    const companyRole = role === 'manager' ? 'manager' : 'employee'
    const { error: membershipError } = await admin.from('company_members').upsert({
      company_id: companyId, profile_id: created.user.id, company_role: companyRole,
      active: true, starts_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,profile_id' })
    if (membershipError) {
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      throw membershipError
    }

    const { error: preferenceError } = await admin.from('user_company_preferences').upsert({
      profile_id: created.user.id, active_company_id: companyId, updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' })
    if (preferenceError) {
      await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      throw preferenceError
    }

      const { error: employmentError } = await admin.from('employee_employment_records').upsert({
      company_id: companyId, profile_id: created.user.id,
      employee_code: `EMP-${created.user.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      employment_type: 'daily', employment_status: 'preboarding',
      daily_rate: 0, monthly_salary: 0, overtime_hourly_rate: 0,
    }, { onConflict: 'company_id,profile_id' })
    if (employmentError) {
      await admin.from('user_company_preferences').delete().eq('profile_id', created.user.id)
      await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      throw employmentError
    }

    return Response.json({
      ok: true,
      employee: { id: created.user.id, email, full_name: fullName, role, company_id: companyId },
    }, { headers: cors })
  } catch (error) {
    console.error(error)
    const message = error instanceof Error ? error.message : 'ไม่สามารถเพิ่มพนักงานได้'
    return sendError({
      error: message,
      error_code: 'UNHANDLED',
      action: message.includes('ยัง') && message.includes('ข้อมูล')
        ? 'ลองกลับไปเพิ่มพนักงานอีกครั้ง หากยังคงเกิดซ้ำให้แจ้งแอดมินระบบตรวจ migration และสิทธิ์ตารางฐานข้อมูล'
        : 'ตรวจข้อมูลที่กรอกอีกครั้ง แล้วลองส่งใหม่',
    }, 400)
  }
})
