import { createClient } from 'npm:@supabase/supabase-js@2'

type CreateEmployeeBody = {
  email?: string
  password?: string
  fullName?: string
  role?: 'employee' | 'manager'
  dryRun?: boolean
  sourceEmployeePersonId?: string
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
  request_id?: string
}

const makeError = (error: string, error_code: string, action: string): ErrorResponse => ({
  error,
  error_code,
  action,
})

const sendError = (error: ErrorResponse, status = 400) =>
  Response.json(error, { status, headers: { ...cors, 'content-type': 'application/json' } })

type AnyObject = { [key: string]: unknown }

const normalizeMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return 'ไม่สามารถเพิ่มพนักงานได้'
  const payload = error as AnyObject
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return 'ไม่สามารถเพิ่มพนักงานได้'
}

const deriveUnhandledCode = (error: unknown): string => {
  const message = normalizeMessage(error).toLowerCase()
  if (message.includes('duplicate') || message.includes('already')) return 'DUPLICATE_RECORD'
  if (message.includes('null value')) return 'MISSING_REQUIRED_FIELD'
  if (message.includes('violates')) return 'CONSTRAINT_VIOLATION'
  if (message.includes('permission') || message.includes('forbidden') || message.includes('denied')) return 'PERMISSION_DENIED'
  return 'UNHANDLED'
}

const mapDatabaseError = (error: unknown): { errorCode: string; action: string; friendly: string; status?: number } => {
  const message = normalizeMessage(error).toLowerCase()
  if (/company member management permission denied/.test(message) || /permission denied/.test(message)) {
    return {
      errorCode: 'PERMISSION_DENIED',
      friendly: 'กำหนดสมาชิกบริษัท: Company member management permission denied',
      action: 'ตรวจสิทธิ์บริษัทให้แน่ใจว่าเป็น Admin/Executive/Manager และบริษัทที่ Active ถูกเลือกถูกต้อง',
      status: 403,
    }
  }
  if (/new row violates row-level security policy/.test(message) && message.includes('user_company_preferences')) {
    return {
      errorCode: 'CONSTRAINT_VIOLATION',
      friendly: 'บันทึก preference บริษัทล้มเหลว: new row violates row-level security policy for table "user_company_preferences"',
      action: 'อัปเดตสิทธิ์ที่ตาราง user_company_preferences ให้สมบูรณ์ (ใช้ service role หรือให้ระบบสร้างค่า preference ใหม่ให้พนักงานใหม่)',
    }
  }
  if (/cross-company/.test(message) || /cross-company profile/.test(message)) {
    return {
      errorCode: 'CONSTRAINT_VIOLATION',
      friendly: 'ข้อมูลข้ามบริษัทไม่ตรงกับขอบเขตระบบ',
      action: 'ตรวจสอบว่า company_id ของการเพิ่มพนักงานตรงกับบริษัทที่ Login อยู่',
    }
  }
  return { errorCode: deriveUnhandledCode(error), friendly: normalizeMessage(error), action: 'ตรวจข้อมูลที่กรอกอีกครั้ง แล้วลองส่งใหม่' }
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  const sendRequestError = (error: ErrorResponse, status = 400) =>
    sendError({ ...error, request_id: requestId }, status)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') {
    return Response.json({
      error: 'Method not allowed',
      error_code: 'UNHANDLED',
      action: 'ใช้ method POST เท่านั้น',
      request_id: requestId,
    }, { status: 405, headers: cors })
  }

  let stage = 'เริ่มทำงาน'
  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
    })
    const admin = createClient(url, serviceKey)
    const actorClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
    })
    stage = 'ยืนยันตัวตน'
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) {
      return sendRequestError(makeError(
        'กรุณาเข้าสู่ระบบใหม่',
        'AUTH_REQUIRED',
        'ออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้งเพื่อขอ token ใหม่',
      ), 401)
    }
    const { data: actorProfile } = await admin.from('profiles').select('role').eq('id', authData.user.id).maybeSingle()
    const isPlatformAdmin = actorProfile?.role === 'admin'

    stage = 'ตรวจสิทธิ์บริษัท'
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
    if (!companyId || (!isPlatformAdmin && (!actorMembership?.active || expired || !['company_admin', 'executive', 'manager'].includes(actorMembership.company_role)))) {
      return sendRequestError(makeError(
        'เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานได้',
        'PERMISSION_DENIED',
        actorMembership?.active === false || expired
          ? 'ตรวจสถานะเป็นสมาชิกของบริษัทในหน้าบริษัทว่ากำลังใช้งานอยู่ และยังไม่หมดอายุ'
          : 'เปิดหน้าเลือกบริษัทให้ตรงกับบริษัทที่สังกัดก่อน แล้วให้สิทธิ์ผู้ใช้งานเป็น Admin/Manager/Executive',
      ), 403)
    }

    stage = 'ตรวจข้อมูล input'
    const body = await request.json() as CreateEmployeeBody
    const email = body.email?.trim().toLowerCase() ?? ''
    const password = body.password ?? ''
    const fullName = body.fullName?.trim() ?? ''
    const role = body.role === 'manager' ? 'manager' : 'employee'
    const sourceEmployeePersonId = body.sourceEmployeePersonId?.trim() || null

    let sourcePerson: {
      id: string
      employee_code: string
      full_name: string
      employment_type: string
      position: string | null
      start_date: string | null
      source_intake_id: string | null
    } | null = null
    if (sourceEmployeePersonId) {
      stage = 'ตรวจทะเบียนพนักงานเตรียมเริ่มงาน'
      const { data, error } = await admin.from('employee_people')
        .select('id,employee_code,full_name,employment_type,position,start_date,source_intake_id,profile_id,employee_status')
        .eq('id', sourceEmployeePersonId).eq('company_id', companyId).maybeSingle()
      if (error) throw error
      if (!data || data.profile_id || data.employee_status !== 'preboarding') {
        return sendRequestError(makeError(
          'ทะเบียนพนักงานนี้ถูกผูกบัญชีแล้วหรือไม่อยู่ในสถานะเตรียมเริ่มงาน',
          'DUPLICATE_RECORD',
          'รีเฟรชรายชื่อแล้วเปิดรายการพนักงานล่าสุด ห้ามสร้างบัญชีซ้ำ',
        ), 409)
      }
      if (data.full_name.trim() !== fullName) {
        return sendRequestError(makeError(
          'ชื่อในบัญชีไม่ตรงกับทะเบียนพนักงานต้นทาง',
          'INVALID_NAME',
          'ใช้ชื่อจากทะเบียนพนักงาน หรือแก้ทะเบียนให้ถูกต้องก่อนสร้างบัญชี',
        ), 400)
      }
      sourcePerson = data
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendRequestError(makeError(
        'รูปแบบอีเมลไม่ถูกต้อง',
        'INVALID_EMAIL',
        'กรุณาใส่อีเมลให้ครบ เช่น name@domain.com',
      ), 400)
    }
    if (fullName.length < 2 || fullName.length > 120) {
      return sendRequestError(makeError(
        'กรุณาระบุชื่อพนักงาน 2-120 ตัวอักษร',
        'INVALID_NAME',
        'กรุณาแก้ชื่อพนักงานให้ยาวอย่างน้อย 2 ตัวอักษรไม่เกิน 120 ตัวอักษร',
      ), 400)
    }
    if (password.length < 10) {
      return sendRequestError(makeError(
        'รหัสผ่านชั่วคราวต้องมีอย่างน้อย 10 ตัวอักษร',
        'INVALID_PASSWORD',
        'เพิ่มความยาวรหัสผ่านชั่วคราวเป็น 10 ตัวขึ้นไป',
      ), 400)
    }

    const plan = {
      actor_id: authData.user.id,
      input_email: email,
      input_full_name: fullName,
      input_role: role,
      company_id: companyId,
      membership_role: role === 'manager' ? 'manager' : 'employee',
      employment_defaults: {
        employment_type: sourcePerson?.employment_type === 'unknown' ? 'daily' : sourcePerson?.employment_type ?? 'daily',
        employment_status: 'preboarding',
        daily_rate: 0,
        monthly_salary: 0,
        overtime_hourly_rate: 0,
      },
      will_write: !body.dryRun,
      preview_note: 'จำลองการสร้างพนักงาน (dry run) แล้ว ไม่ได้บันทึกข้อมูลลง DB',
    }

    if (body.dryRun) {
      return Response.json({
        ok: true,
        dry_run: true,
        plan,
        request_id: requestId,
      }, { headers: { ...cors } })
    }

    stage = 'สร้างบัญชี Auth'
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message)
      if (duplicate) {
        return sendRequestError(makeError(
          'อีเมลนี้มีบัญชีอยู่แล้ว',
          'EMAIL_ALREADY_EXISTS',
          'เปลี่ยนอีเมลใหม่ หรือให้ทีม IT ปิดบัญชีเดิมก่อนลองใหม่อีกครั้ง',
        ), 409)
      }
      return sendRequestError(makeError(
        createError.message,
        'AUTH_CREATE_FAILED',
        'ตรวจสอบสิทธิ์การสร้างบัญชีในระบบ Auth และลองใหม่อีกครั้ง',
      ))
    }
    if (!created.user) throw new Error('ไม่สามารถสร้างบัญชีพนักงานได้')

    stage = 'บันทึก profiles'
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
    stage = 'กำหนดสมาชิกบริษัท'
    const { error: membershipError } = await actorClient.from('company_members').upsert({
      company_id: companyId, profile_id: created.user.id, company_role: companyRole,
      active: true, starts_on: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,profile_id' })
    if (membershipError) {
      const mapped = mapDatabaseError(membershipError)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      return sendRequestError({
        error: `${stage}: ${mapped.friendly}`,
        error_code: mapped.errorCode,
        action: mapped.action,
      }, mapped.status ?? 400)
    }

    stage = 'บันทึกค่า preference'
    const { error: preferenceError } = await admin.from('user_company_preferences').upsert({
      profile_id: created.user.id, active_company_id: companyId, updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' })
    if (preferenceError) {
      await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      const mapped = mapDatabaseError(preferenceError)
      return sendRequestError({
        error: `${stage}: ${mapped.friendly}`,
        error_code: mapped.errorCode,
        action: mapped.action,
      }, mapped.status ?? 400)
    }

    stage = 'สร้างข้อมูลพนักงาน'
    const { error: employmentError } = await actorClient.from('employee_employment_records').upsert({
      company_id: companyId, profile_id: created.user.id,
      employee_code: sourcePerson?.employee_code ?? `EMP-${created.user.id.replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      employment_type: sourcePerson?.employment_type === 'unknown' ? 'daily' : sourcePerson?.employment_type ?? 'daily',
      job_title: sourcePerson?.position ?? null,
      hired_on: sourcePerson?.start_date ?? null,
      employment_status: 'preboarding',
      daily_rate: 0, monthly_salary: 0, overtime_hourly_rate: 0,
    }, { onConflict: 'company_id,profile_id' })
    if (employmentError) {
      await admin.from('user_company_preferences').delete().eq('profile_id', created.user.id)
      await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
      await admin.from('profiles').delete().eq('id', created.user.id)
      await admin.auth.admin.deleteUser(created.user.id)
      throw employmentError
    }

    if (sourcePerson) {
      stage = 'ผูกบัญชีกับทะเบียนพนักงานเดิม'
      const { data: linkedPerson, error: linkError } = await admin.from('employee_people').update({
        profile_id: created.user.id,
        updated_at: new Date().toISOString(),
      }).eq('id', sourcePerson.id).eq('company_id', companyId).is('profile_id', null).select('id').maybeSingle()
      if (linkError || !linkedPerson) {
        await admin.from('employee_employment_records').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
        await admin.from('user_company_preferences').delete().eq('profile_id', created.user.id)
        await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
        await admin.from('profiles').delete().eq('id', created.user.id)
        await admin.auth.admin.deleteUser(created.user.id)
        if (linkError) throw linkError
        throw new Error('employee_preboarding_profile_link_conflict')
      }
      const { error: auditError } = await admin.from('employee_workforce_audit_logs').insert({
        company_id: companyId,
        profile_id: created.user.id,
        actor_profile_id: authData.user.id,
        entity_type: 'employee_person',
        entity_id: sourcePerson.id,
        action: 'employee_preboarding_account_linked',
        reason: 'Admin สร้างบัญชี Login จากทะเบียนเตรียมเริ่มงานเดิม โดยยังคงสถานะ preboarding จนกว่าจะตั้งค่าครบ',
        new_values: {
          source_intake_id: sourcePerson.source_intake_id,
          employee_code: sourcePerson.employee_code,
          profile_id: created.user.id,
        },
      })
      if (auditError) {
        await admin.from('employee_people').update({ profile_id: null, updated_at: new Date().toISOString() }).eq('id', sourcePerson.id).eq('profile_id', created.user.id)
        await admin.from('employee_employment_records').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
        await admin.from('user_company_preferences').delete().eq('profile_id', created.user.id)
        await admin.from('company_members').delete().eq('company_id', companyId).eq('profile_id', created.user.id)
        await admin.from('profiles').delete().eq('id', created.user.id)
        await admin.auth.admin.deleteUser(created.user.id)
        throw auditError
      }
    }

    return Response.json({
      ok: true,
      dry_run: false,
      plan,
      request_id: requestId,
      employee: { id: created.user.id, email, full_name: fullName, role, company_id: companyId },
    }, { headers: cors })
  } catch (error) {
    console.error(error)
    const message = normalizeMessage(error)
    const errorCode = deriveUnhandledCode(error)
    return sendRequestError({
      error: `${stage}: ${message}`,
      error_code: errorCode,
      action: message.includes('ยัง') && message.includes('ข้อมูล')
        ? 'ลองกลับไปเพิ่มพนักงานอีกครั้ง หากยังคงเกิดซ้ำให้แจ้งแอดมินระบบตรวจ migration และสิทธิ์ตารางฐานข้อมูล'
        : 'ตรวจข้อมูลที่กรอกอีกครั้ง แล้วลองส่งใหม่',
    }, 400)
  }
})
