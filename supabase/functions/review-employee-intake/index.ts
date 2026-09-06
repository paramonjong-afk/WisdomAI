import { createClient } from 'npm:@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

type ReviewEmployeeIntakeBody = {
  action?: 'create_preboarding' | 'update_preboarding' | 'approve' | 'request_more' | 'cancel' | 'revert_approval'
  intake_id?: string
  draft?: { full_name?: string; phone?: string; employment_type?: string; position?: string; start_date?: string }
}

type ErrorResponse = {
  error: string
  error_code: string
  action: string
}

const errorResponse = (error: string, code: string, action: string, status = 400) =>
  Response.json({ error, error_code: code, action } as ErrorResponse, {
    status,
    headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
  })

const normalizeMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return 'ไม่สามารถดำเนินการรายการนี้ได้'
  const payload = error as Record<string, unknown>
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return 'ไม่สามารถดำเนินการรายการนี้ได้'
}

const mapError = (
  error: unknown,
): { message: string; code: string; action: string; status?: number } => {
  const message = normalizeMessage(error)
  if (/employee_intake_not_found/i.test(message)) return {
    message: 'ไม่พบรายการ intake หรือไม่มีสิทธิ์จัดการรายการนี้',
    code: 'INTAKE_NOT_FOUND',
    action: 'ตรวจสอบ intake_id และสิทธิ์บริษัทที่ใช้งาน',
    status: 404,
  }
  if (/employee_intake_not_ready/i.test(message)) return {
    message: 'ข้อมูลยังไม่พร้อมอนุมัติ (สถานะไม่พร้อมหรือยังมีช่องข้อมูลค้าง)',
    code: 'UNREADY_FOR_APPROVAL',
    action: 'กรุณารอข้อมูลครบก่อนแล้วลองอัปเดตอีกครั้ง',
    status: 409,
  }
  if (/employee_intake_candidate_name_required/i.test(message)) return {
    message: 'ยังไม่พบชื่อพนักงานที่ยืนยันได้', code: 'CANDIDATE_NAME_REQUIRED',
    action: 'ตรวจชื่อจากเอกสารหรือกรอกชื่อให้ถูกต้องก่อนสร้างประวัติเบื้องต้น', status: 409,
  }
  if (/employee_intake_document_required/i.test(message)) return {
    message: 'ยังไม่มีเอกสารต้นฉบับที่เชื่อมกับ Intake', code: 'DOCUMENT_REQUIRED',
    action: 'ตรวจการนำเข้าเอกสาร แล้วลองสร้างประวัติเบื้องต้นอีกครั้ง', status: 409,
  }
  if (/employee_intake_preboarding_not_actionable/i.test(message)) return {
    message: 'รายการนี้ปิดหรืออนุมัติไปแล้ว จึงสร้างประวัติเบื้องต้นซ้ำไม่ได้', code: 'INVALID_STATE',
    action: 'รีเฟรชและตรวจสถานะ Employee Master ของรายการนี้', status: 409,
  }
  if (/employee_intake_preboarding_not_found/i.test(message)) return {
    message: 'ไม่พบประวัติพนักงานเบื้องต้นที่แก้ไขได้', code: 'PREBOARDING_NOT_FOUND',
    action: 'รีเฟรชหน้าพนักงานแล้วตรวจว่ารายการยังอยู่ในคิว HR Onboarding', status: 409,
  }
  if (/employee_intake_phone_invalid/i.test(message)) return {
    message: 'รูปแบบเบอร์โทรไม่ถูกต้อง', code: 'INVALID_PHONE',
    action: 'กรอกเบอร์โทร 8-20 หลัก ใช้ได้เฉพาะตัวเลข เครื่องหมาย + และ -', status: 400,
  }
  if (/employee_intake_start_date_invalid/i.test(message)) return {
    message: 'วันที่เริ่มงานไม่ถูกต้อง', code: 'INVALID_START_DATE', action: 'เลือกวันที่เริ่มงานใหม่', status: 400,
  }
  if (/employee_intake_employment_type_invalid/i.test(message)) return {
    message: 'ประเภทการจ้างไม่ถูกต้อง', code: 'INVALID_EMPLOYMENT_TYPE', action: 'เลือกประเภทการจ้างจากรายการ', status: 400,
  }
  if (/employee_intake_approval_denied/i.test(message)) return {
    message: 'สิทธิ์การอนุมัติไม่เพียงพอ',
    code: 'PERMISSION_DENIED',
    action: 'ตรวจสอบสิทธิ์ Admin/Manager/Executive และสถานะสมาชิกบริษัท (active และไม่หมดอายุ)',
    status: 403,
  }
  if (/not authorized|authorization|permission denied/i.test(message)) return {
    message: 'ไม่มีสิทธิ์เข้าถึงรายการ',
    code: 'PERMISSION_DENIED',
    action: 'ลงชื่อเข้าใช้ใหม่และเลือกบริษัทที่ถูกต้องก่อนดำเนินการ',
    status: 403,
  }
  if (/already|duplicate/i.test(message)) return {
    message: 'พบรายการซ้ำ/จัดการไปแล้ว',
    code: 'DUPLICATE_RECORD',
    action: 'รายการนี้อาจถูกดำเนินการแล้ว ลองรีเฟรชหน้าจอและตรวจสอบสถานะอีกครั้ง',
  }
  if (/constraint|violates|foreign key|policy/i.test(message)) return {
    message: 'ข้อมูลไม่สอดคล้องกฎความปลอดภัย/ข้อจำกัดของระบบ',
    code: 'CONSTRAINT_VIOLATION',
    action: 'ตรวจสิทธิ์ RLS และความสัมพันธ์ข้อมูลของบริษัทจากทีมดูแลระบบ',
  }
  return {
    message,
    code: 'UNHANDLED',
    action: 'ตรวจข้อมูลและลองส่งใหม่อีกครั้ง',
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return errorResponse('Method not allowed', 'METHOD_NOT_ALLOWED', 'ใช้ POST เท่านั้น', 405)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: request.headers.get('authorization') ?? '' } },
  })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  try {
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) {
      return errorResponse('กรุณาเข้าสู่ระบบใหม่', 'AUTH_REQUIRED', 'ออก/เข้าสู่ระบบใหม่แล้วลองทำรายการอีกครั้ง', 401)
    }

    const { data: preference } = await admin
      .from('user_company_preferences')
      .select('active_company_id')
      .eq('profile_id', authData.user.id)
      .maybeSingle()

    const { data: actorProfile } = await admin.from('profiles').select('role').eq('id', authData.user.id).maybeSingle()
    const isPlatformAdmin = actorProfile?.role === 'admin'

    let companyId = preference?.active_company_id ?? null
    if (!companyId) {
      const { data: fallback } = await admin
        .from('company_members')
        .select('company_id')
        .eq('profile_id', authData.user.id)
        .eq('active', true)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      companyId = fallback?.company_id ?? null
    }

    const { data: actorMembership } = companyId
      ? await admin
        .from('company_members')
        .select('company_role,active,ends_on')
        .eq('company_id', companyId)
        .eq('profile_id', authData.user.id)
        .maybeSingle()
      : { data: null }

    const today = new Date().toISOString().slice(0, 10)
    const actorExpired = actorMembership?.ends_on && actorMembership.ends_on < today
    if (!companyId || (!isPlatformAdmin && (!actorMembership?.active || actorExpired || !['company_admin', 'executive', 'manager'].includes(actorMembership.company_role)))) {
      return errorResponse(
        'สิทธิ์ของผู้ใช้งานไม่พอสำหรับการอนุมัติ intake นี้',
        'PERMISSION_DENIED',
        'ตรวจสิทธิ์บริษัทที่เลือกอยู่ ว่าเป็น Admin/Manager/Executive และยัง active อยู่',
        403,
      )
    }

    const body = await request.json() as ReviewEmployeeIntakeBody
    const action = body?.action
    const intakeId = body?.intake_id?.trim()

    if (!action || !['create_preboarding', 'update_preboarding', 'approve', 'request_more', 'cancel', 'revert_approval'].includes(action)) {
      return errorResponse('ข้อมูล action ไม่ถูกต้อง', 'INVALID_ACTION', 'เลือกการดำเนินการที่ถูกต้อง', 400)
    }
    if (!intakeId) {
      return errorResponse('ข้อมูล intake_id ไม่ครบ', 'INVALID_INTAKE_ID', 'เลือกรายการ HR Intake ก่อนกดยืนยัน', 400)
    }

  const { data: targetIntake, error: intakeError } = await admin
      .from('employee_intakes')
      .select('id,status,company_id,missing_fields')
      .eq('id', intakeId)
      .maybeSingle()

    if (intakeError || !targetIntake) {
      return errorResponse('ไม่พบ intake ที่ระบุ', 'INTAKE_NOT_FOUND', 'ตรวจข้อมูล intake_id และสิทธิ์บริษัทที่ใช้งาน', 404)
    }
    if (targetIntake.company_id !== companyId) {
      return errorResponse('ไม่พบสิทธิ์จัดการ intake นี้', 'INTAKE_NOT_FOUND', 'ตรวจสอบว่า intake นี้อยู่ในบริษัทที่คุณเลือกอยู่', 404)
    }

    if (action === 'create_preboarding') {
      const { data: draft, error: draftError } = await admin.rpc('create_employee_preboarding_from_intake', {
        target_intake_id: intakeId,
        actor_profile_id: authData.user.id,
      })
      if (draftError) {
        const mapped = mapError(draftError)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }
      return Response.json({
        ok: true,
        action: 'create_preboarding',
        intake_id: intakeId,
        employee_id: draft?.[0]?.employee_id ?? null,
        employee_code: draft?.[0]?.employee_code ?? null,
        result_status: draft?.[0]?.result_status ?? 'preboarding_created',
        remaining_fields: draft?.[0]?.remaining_fields ?? [],
        linked_document_count: draft?.[0]?.linked_document_count ?? 0,
      }, { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } })
    }

    if (action === 'update_preboarding') {
      const { data: updated, error: updateError } = await admin.rpc('update_employee_preboarding_from_intake', {
        target_intake_id: intakeId,
        actor_profile_id: authData.user.id,
        draft: body.draft ?? {},
      })
      if (updateError) {
        const mapped = mapError(updateError)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }
      return Response.json({
        ok: true, action: 'update_preboarding', intake_id: intakeId,
        employee_id: updated?.[0]?.employee_id ?? null,
        employee_code: updated?.[0]?.employee_code ?? null,
        result_status: updated?.[0]?.result_status ?? 'preboarding_updated',
        remaining_fields: updated?.[0]?.remaining_fields ?? [],
        ready_for_approval: updated?.[0]?.ready_for_approval ?? false,
      }, { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } })
    }

    if (action === 'approve') {
      const { data: approval, error: approveError } = await admin.rpc('approve_employee_intake', {
        target_intake_id: intakeId,
        actor_profile_id: authData.user.id,
      })
      if (approveError) {
        const mapped = mapError(approveError)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }

      return Response.json(
        {
          ok: true,
          action: 'approve',
          intake_id: intakeId,
          employee_id: approval?.[0]?.employee_id ?? null,
          employee_code: approval?.[0]?.employee_code ?? null,
          result_status: approval?.[0]?.result_status ?? 'approved',
        },
        { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } },
      )
    }

    if (action === 'revert_approval') {
      if (targetIntake.status !== 'approved') {
        return errorResponse('รายการนี้ยังไม่อยู่สถานะอนุมัติ', 'INVALID_STATE', 'ใช้ย้อนอนุมัติได้เฉพาะรายการที่สเตตัสเป็น "อนุมัติแล้ว"', 409)
      }

      const { data: peopleData, error: peopleQueryError } = await admin
        .from('employee_people')
        .select('id')
        .eq('source_intake_id', intakeId)
        .eq('company_id', companyId)
        .maybeSingle()
      if (peopleQueryError) {
        const mapped = mapError(peopleQueryError)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }

      if (peopleData?.id) {
        const { error: deletePersonError } = await admin
          .from('employee_people')
          .delete()
          .eq('id', peopleData.id)
          .eq('company_id', companyId)
        if (deletePersonError) {
          const mapped = mapError(deletePersonError)
          return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
        }
      }

      const { error: revertError, data: reverted } = await admin
        .from('employee_intakes')
        .update({
          status: 'pending_review',
          reviewed_by: null,
          reviewed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', intakeId)
        .eq('company_id', companyId)
        .select('id,status')
        .single()

      if (revertError) {
        const mapped = mapError(revertError)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }

      return Response.json(
        { ok: true, action: 'revert_approval', intake_id: intakeId, status: reverted?.status ?? 'pending_review' },
        { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } },
      )
    }

    if (action === 'request_more') {
      const nextMissing = (targetIntake.missing_fields ?? [])
        .concat('ข้อมูลจากฝ่าย HR ยังไม่ครบ')
        .filter((value: string, index: number, self: string[]) => self.indexOf(value) === index)

      const updateResult = await admin
        .from('employee_intakes')
        .update({
          status: 'information_required',
          missing_fields: nextMissing,
          reviewed_by: null,
          reviewed_at: null,
          submitted_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', intakeId)
        .eq('company_id', companyId)
        .select('id,status')
        .single()

      if (updateResult.error) {
        const mapped = mapError(updateResult.error)
        return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
      }

      return Response.json(
        { ok: true, action: 'request_more', intake_id: intakeId, status: updateResult.data?.status ?? 'information_required' },
        { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } },
      )
    }

    const { error: cancelError } = await admin
      .from('employee_intakes')
      .update({
        status: 'cancelled',
        reviewed_by: authData.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', intakeId)
      .eq('company_id', companyId)

    if (cancelError) {
      const mapped = mapError(cancelError)
      return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
    }

    return Response.json(
      { ok: true, action: 'cancel', intake_id: intakeId, status: 'cancelled' },
      { headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } },
    )
  } catch (error) {
    const mapped = mapError(error)
    return errorResponse(mapped.message, mapped.code, mapped.action, mapped.status ?? 400)
  }
})
