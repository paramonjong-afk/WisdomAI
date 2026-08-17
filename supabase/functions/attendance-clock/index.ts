import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendLinePush } from '../_shared/line-quota.ts'

type ClockBody = {
  action: 'clock_in' | 'clock_out'
  siteId?: string
  latitude: number | null
  longitude: number | null
  accuracy?: number | null
  gpsErrorCode?: string
  gpsErrorMessage?: string
  selfiePath: string
  device?: {
    id?: string
    label?: string
    ownerName?: string
    platform?: string
    userAgent?: string
    screen?: string
    timezone?: string
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const distanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const radius = 6_371_000
  const radians = Math.PI / 180
  const latitudeDelta = (lat2 - lat1) * radians
  const longitudeDelta = (lon2 - lon1) * radians
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(value))
}

const cleanText = (value: unknown, maxLength: number) =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

const deviceInfo = (device: ClockBody['device']) => ({
  label: cleanText(device?.label, 120) || 'ไม่ทราบอุปกรณ์',
  ownerName: cleanText(device?.ownerName, 120) || 'ยังไม่ระบุเจ้าของมือถือ',
  platform: cleanText(device?.platform, 80),
  userAgent: cleanText(device?.userAgent, 500),
  screen: cleanText(device?.screen, 40),
  timezone: cleanText(device?.timezone, 80),
})

const bangkokDayRange = (date: Date) => {
  const bangkokDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const start = new Date(`${bangkokDate}T00:00:00+07:00`)
  return { businessDate: bangkokDate, start, end: new Date(start.getTime() + 86_400_000) }
}

type LineNotification = {
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

type AttendanceSite = {
  id: string
  company_id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  line_group_id: string | null
  work_policy_id: string | null
  projects: { name: string } | null
}

async function notifyLine(groupId: string | null, message: string): Promise<LineNotification> {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  const result = await sendLinePush({ token, to: groupId, messages: [{ type: 'text', text: message }], priority: 'normal' })
  return { status: result.status === 'quota_blocked' ? 'skipped' : result.status, reason: result.error ?? undefined }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })

  try {
    const authorization = request.headers.get('Authorization') ?? ''
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
    const admin = createClient(url, serviceKey)
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: cors })

    const userId = authData.user.id
    const { data: preference, error: preferenceError } = await admin
      .from('user_company_preferences')
      .select('active_company_id')
      .eq('profile_id', userId)
      .maybeSingle()
    if (preferenceError) throw preferenceError
    const companyId = preference?.active_company_id as string | undefined
    if (!companyId) {
      return Response.json({ error: 'กรุณาเลือกบริษัทก่อนลงเวลา' }, { status: 403, headers: cors })
    }
    const { data: membership, error: membershipError } = await admin
      .from('company_members')
      .select('company_role,member_type')
      .eq('company_id', companyId)
      .eq('profile_id', userId)
      .eq('active', true)
      .or(`ends_on.is.null,ends_on.gte.${new Date().toISOString().slice(0, 10)}`)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) {
      return Response.json({ error: 'บัญชีนี้ไม่ได้เป็นสมาชิกบริษัทที่เลือก' }, { status: 403, headers: cors })
    }
    if (membership.member_type === 'admin_only') {
      return Response.json({ error: 'บัญชีผู้ดูแลนี้ไม่ได้ถูกกำหนดเป็นพนักงานบริษัท จึงไม่สามารถลงเวลาได้' }, { status: 403, headers: cors })
    }

    const body = await request.json() as ClockBody
    if (!['clock_in', 'clock_out'].includes(body.action)) {
      return Response.json({ error: 'คำสั่งลงเวลาไม่ถูกต้อง' }, { status: 400, headers: cors })
    }
    if (!body.selfiePath) return Response.json({ error: 'ข้อมูลรูปถ่ายไม่ครบ' }, { status: 400, headers: cors })
    const hasCoordinates=Number.isFinite(body.latitude)&&Number.isFinite(body.longitude)
    if (!hasCoordinates && !cleanText(body.gpsErrorCode,50)) {
      return Response.json({error:'ไม่มีพิกัดและไม่พบรหัสปัญหา GPS'},{status:400,headers:cors})
    }
    if (hasCoordinates && (Number(body.latitude) < -90 || Number(body.latitude) > 90 || Number(body.longitude) < -180 || Number(body.longitude) > 180)) {
      return Response.json({ error: 'ค่าพิกัดไม่ถูกต้อง กรุณาเปิด GPS และลองใหม่' }, { status: 400, headers: cors })
    }
    const { data: settings } = await admin.from('attendance_system_settings')
      .select('max_gps_accuracy_meters,allow_outside_site_for_review,shared_devices_allowed,stale_session_mode')
      .eq('company_id', companyId).eq('singleton', true).maybeSingle()
    const { data: workforceRules } = await admin.from('workforce_rule_settings')
      .select('max_shift_minutes,allow_overnight_shifts')
      .eq('company_id', companyId).eq('singleton', true).maybeSingle()
    const maxShiftMinutes = Number(workforceRules?.max_shift_minutes ?? 720)
    const allowOvernightShifts = Boolean(workforceRules?.allow_overnight_shifts)
    const maxGpsAccuracy = Number(settings?.max_gps_accuracy_meters ?? 200)
    const inaccurateGps = hasCoordinates && (!Number.isFinite(body.accuracy) || Number(body.accuracy) > maxGpsAccuracy)
    const gpsUnavailable=!hasCoordinates
    const gpsErrorCode=cleanText(body.gpsErrorCode,50)||null
    const gpsErrorMessage=cleanText(body.gpsErrorMessage,300)||null
    const policyAction=async(companyId:string,errorCode:string)=>{
      const {data}=await admin.from('attendance_gps_error_policies').select('action').eq('company_id',companyId).eq('error_code',errorCode).eq('active',true).maybeSingle()
      return (data?.action??'review') as 'allow'|'review'|'reject'
    }

    if (!body.selfiePath.startsWith(`${userId}/`) || body.selfiePath.includes('..')) {
      return Response.json({ error: 'ไฟล์ Selfie ไม่ใช่ของบัญชีที่กำลังลงเวลา' }, { status: 400, headers: cors })
    }
    const selfieParts = body.selfiePath.split('/')
    const selfieName = selfieParts.pop() ?? ''
    const selfieFolder = selfieParts.join('/')
    const { data: selfieFiles, error: selfieError } = await admin.storage
      .from('attendance-selfies').list(selfieFolder, { search: selfieName, limit: 10 })
    if (selfieError || !selfieFiles?.some((file) => file.name === selfieName)) {
      return Response.json({ error: 'ไม่พบไฟล์ Selfie กรุณาถ่ายรูปใหม่' }, { status: 400, headers: cors })
    }
    const { data: profile } = await admin.from('profiles').select('full_name,email').eq('id', userId).single()
    const employeeName = profile?.full_name?.trim()
    if (!employeeName) {
      return Response.json({
        error: 'ยังไม่ได้ระบุชื่อพนักงาน กรุณาเปิดเมนู Employees เพื่อบันทึกชื่อก่อนลงเวลา',
      }, { status: 400, headers: cors })
    }
    const isManager = ['company_admin', 'executive', 'manager', 'site_supervisor'].includes(membership.company_role)
    const { data: employment } = await admin.from('employee_employment_records')
      .select('employment_status').eq('company_id', companyId).eq('profile_id', userId).maybeSingle()
    if (!employment) {
      return Response.json({ error: 'ยังไม่มีข้อมูลสถานะการจ้างงาน กรุณาติดต่อผู้จัดการ' }, { status: 403, headers: cors })
    }
    if (!['probation', 'active', 'notice'].includes(employment.employment_status)) {
      return Response.json({ error: 'สถานะการจ้างงานของบัญชีนี้ไม่อนุญาตให้ลงเวลา' }, { status: 403, headers: cors })
    }
    const attendanceDeviceId = cleanText(body.device?.id, 100) || null
    const attendanceDeviceInfo = deviceInfo(body.device)
    if (!settings?.shared_devices_allowed
      && attendanceDeviceInfo.ownerName !== 'ยังไม่ระบุเจ้าของมือถือ'
      && attendanceDeviceInfo.ownerName !== employeeName) {
      return Response.json({
        error: `มือถือเครื่องนี้ระบุเจ้าของเป็น ${attendanceDeviceInfo.ownerName} ไม่ตรงกับบัญชี ${employeeName}`,
      }, { status: 400, headers: cors })
    }
    const now = new Date()
    let site: AttendanceSite | null = null
    let attendanceId = ''
    let status = 'normal'
    let finalDistance:number|null=null

    if (body.action === 'clock_in') {
      if (!body.siteId) throw new Error('กรุณาเลือกไซต์')
      const today = bangkokDayRange(now)
      const { data: existingToday, error: existingTodayError } = await admin
        .from('attendance_sessions')
        .select('id,clock_in_at,clock_out_at,status,project_sites(name)')
        .eq('company_id', companyId)
        .eq('profile_id', userId)
        .gte('clock_in_at', today.start.toISOString())
        .lt('clock_in_at', today.end.toISOString())
        .not('status', 'in', '(rejected,duplicate)')
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingTodayError) throw existingTodayError
      if (existingToday) {
        if (existingToday.clock_out_at) {
          return Response.json({
            ok: true,
            alreadyRecorded: true,
            attendanceId: existingToday.id,
            status: existingToday.status,
            message: 'วันนี้คุณลงเวลาเข้าและออกครบแล้ว ระบบไม่สร้างรายการซ้ำ',
          }, { headers: cors })
        }
        throw new Error('วันนี้คุณลงเวลาเข้าแล้ว กรุณาลงเวลาออกจากรายการเดิม')
      }
      const { data: existingOpen, error: existingOpenError } = await admin
        .from('attendance_sessions')
        .select('id,clock_in_at,project_sites(name)')
        .eq('company_id', companyId)
        .eq('profile_id', userId)
        .is('clock_out_at', null)
        .not('status', 'in', '(rejected,duplicate)')
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingOpenError) throw existingOpenError
      if (existingOpen) {
        const existingIsToday = new Date(existingOpen.clock_in_at) >= today.start
          && new Date(existingOpen.clock_in_at) < today.end
        if (!existingIsToday) {
          await admin.from('attendance_sessions').update({
            status: 'needs_review',
            calculation_status: 'needs_review',
            worked_minutes: null,
            normal_minutes: null,
            overtime_minutes: 0,
            review_category: 'missing_clock_out',
            review_requested_at: now.toISOString(),
            review_reason: 'รายการลงเวลาเข้าค้างข้ามวันและไม่มีเวลาออก ส่งให้ผู้จัดการตรวจสอบ',
            updated_at: now.toISOString(),
          }).eq('company_id', companyId).eq('id', existingOpen.id)
        } else {
        const existingTime = new Date(existingOpen.clock_in_at).toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
        const existingSite = (existingOpen.project_sites as unknown as { name?: string } | null)?.name ?? '-'
        throw new Error(`คุณลงเวลาเข้าแล้ว เวลา ${existingTime} ที่ไซต์ ${existingSite} กรุณาลงเวลาออกก่อน`)
        }
      }

      const { data, error: siteError } = await admin.from('project_sites')
        .select('id,company_id,name,latitude,longitude,radius_meters,line_group_id,work_policy_id,projects(name)')
        .eq('company_id', companyId).eq('id', body.siteId).eq('active', true).single()
      if (siteError || !data) throw new Error('ไม่พบไซต์ที่เลือก')
      site = data as unknown as AttendanceSite

      const { data: assignment } = await admin.from('employee_site_assignments').select('id,work_policy_id')
        .eq('company_id', companyId).eq('profile_id', userId).eq('site_id', body.siteId).eq('active', true)
        .lte('starts_on', today.businessDate).or(`ends_on.is.null,ends_on.gte.${today.businessDate}`)
        .order('starts_on',{ascending:false}).limit(1).maybeSingle()
      if (!isManager && !assignment) throw new Error('คุณยังไม่ได้รับมอบหมายให้ไซต์นี้')
      const {data:employment}=await admin.from('employee_employment_records').select('work_policy_id')
        .eq('company_id',companyId).eq('profile_id',userId).maybeSingle()
      const resolvedPolicyId=assignment?.work_policy_id??employment?.work_policy_id??site.work_policy_id??null
      const policySource=assignment?.work_policy_id?'assignment':employment?.work_policy_id?'employee':site.work_policy_id?'site':'none'
      const {data:resolvedPolicy}=resolvedPolicyId?await admin.from('work_policies')
        .select('id,name,work_start_time,work_end_time,break_start_time,break_end_time,grace_minutes,standard_minutes,overtime_round_minutes')
        .eq('company_id',companyId).eq('id',resolvedPolicyId).maybeSingle():{data:null}

      const meters = hasCoordinates ? distanceMeters(Number(body.latitude),Number(body.longitude),site.latitude,site.longitude) : null
      finalDistance=meters
      const outsideSite = meters!==null&&meters > site.radius_meters
      const policyCode=gpsUnavailable?(gpsErrorCode??'gps_unavailable'):outsideSite?'outside_site':inaccurateGps?'gps_inaccurate':null
      const action=policyCode?await policyAction(site.company_id,policyCode):'allow'
      if(action==='reject')throw new Error(`นโยบายบริษัทไม่รับรายการกรณี ${policyCode}`)
      status = action==='review' ? 'needs_review' : 'normal'
      const reviewReason = [
        outsideSite && meters!==null ? `อยู่นอกพื้นที่ไซต์ ${Math.round(meters)} เมตร` : '',
        inaccurateGps ? `GPS คลาดเคลื่อน ${Math.round(Number(body.accuracy) || 0)} เมตร` : '',
        gpsUnavailable ? `ไม่มีพิกัด GPS: ${gpsErrorCode} ${gpsErrorMessage??''}` : '',
      ].filter(Boolean).join(' · ') || null
      const reviewCategory = gpsUnavailable?'gps_unavailable':outsideSite && inaccurateGps ? 'multiple'
        : outsideSite ? 'gps_outside' : inaccurateGps ? 'gps_inaccurate' : null
      const { data: created, error: insertError } = await admin.from('attendance_sessions').insert({
        company_id: companyId, profile_id: userId, site_id: site.id, clock_in_at: now.toISOString(),
        assignment_id:assignment?.id??null,resolved_work_policy_id:resolvedPolicyId,policy_source:policySource,
        policy_snapshot:resolvedPolicy?{...resolvedPolicy,resolved_at:now.toISOString(),business_date:today.businessDate}:null,
        clock_in_latitude: hasCoordinates?body.latitude:null, clock_in_longitude: hasCoordinates?body.longitude:null,
        clock_in_accuracy_meters: body.accuracy ?? null, clock_in_distance_meters: meters,
        clock_in_selfie_path: body.selfiePath, status, review_reason: reviewReason,
        review_category: reviewCategory,
        review_requested_at: status === 'needs_review' ? now.toISOString() : null,
        review_channel: status === 'needs_review' ? 'line_group' : null,
        clock_in_device_id: attendanceDeviceId, clock_in_device_info: attendanceDeviceInfo,
      }).select('id').single()
      if (insertError?.code === '23505') {
        throw new Error('วันนี้มีรายการลงเวลาแล้ว ไม่สามารถลงเวลาเข้าเพิ่มได้')
      }
      if (insertError) throw insertError
      attendanceId = created.id
    } else {
      const { data: open, error: openError } = await admin.from('attendance_sessions')
        .select('id,site_id,status,clock_in_at,project_sites(id,company_id,name,latitude,longitude,radius_meters,line_group_id,projects(name))')
        .eq('company_id', companyId).eq('profile_id', userId)
        .is('clock_out_at', null)
        .not('status', 'in', '(rejected,duplicate)')
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openError) throw openError
      if (!open) {
        const today = bangkokDayRange(now)
        const { data: completed } = await admin.from('attendance_sessions')
          .select('id,status,clock_out_at')
          .eq('company_id', companyId).eq('profile_id', userId)
          .gte('clock_in_at', today.start.toISOString())
          .lt('clock_in_at', today.end.toISOString())
          .not('status', 'in', '(rejected,duplicate)')
          .not('clock_out_at', 'is', null)
          .order('clock_out_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (completed) {
          return Response.json({
            ok: true,
            alreadyRecorded: true,
            attendanceId: completed.id,
            status: completed.status,
            message: 'วันนี้คุณลงเวลาออกแล้ว ระบบไม่สร้างรายการซ้ำ',
          }, { headers: cors })
        }
        throw new Error('ไม่พบรายการที่กำลังทำงาน')
      }
      site = open.project_sites as unknown as AttendanceSite | null
      if (!site) throw new Error('ไม่พบข้อมูลไซต์')
      const elapsedMinutes = Math.floor((now.getTime() - new Date(open.clock_in_at).getTime()) / 60_000)
      const crossesBusinessDate = bangkokDayRange(new Date(open.clock_in_at)).businessDate !== bangkokDayRange(now).businessDate
      const invalidDuration = elapsedMinutes < 0 || elapsedMinutes > maxShiftMinutes
        || (crossesBusinessDate && !allowOvernightShifts)
      const meters = hasCoordinates ? distanceMeters(Number(body.latitude),Number(body.longitude),site.latitude,site.longitude) : null
      finalDistance=meters
      const outsideSite = meters!==null&&meters > site.radius_meters
      const policyCode=gpsUnavailable?(gpsErrorCode??'gps_unavailable'):outsideSite?'outside_site':inaccurateGps?'gps_inaccurate':null
      const action=policyCode?await policyAction(site.company_id,policyCode):'allow'
      if(action==='reject')throw new Error(`นโยบายบริษัทไม่รับรายการกรณี ${policyCode}`)
      status = open.status === 'needs_review' || action==='review' || invalidDuration ? 'needs_review' : 'normal'
      const reviewReason = [
        open.status === 'needs_review' ? 'รายการเข้าอยู่ระหว่างตรวจสอบ' : '',
        invalidDuration ? `ระยะเวลาลงงาน ${elapsedMinutes} นาที ผิดเงื่อนไขกะสูงสุด ${maxShiftMinutes} นาที${crossesBusinessDate&&!allowOvernightShifts?' และข้ามวัน':''}` : '',
        outsideSite && meters!==null ? `เวลาออกอยู่นอกพื้นที่ไซต์ ${Math.round(meters)} เมตร` : '',
        inaccurateGps ? `GPS เวลาออกคลาดเคลื่อน ${Math.round(Number(body.accuracy) || 0)} เมตร` : '',
        gpsUnavailable ? `ไม่มีพิกัดเวลาออก: ${gpsErrorCode} ${gpsErrorMessage??''}` : '',
      ].filter(Boolean).join(' · ') || null
      const reviewCategory = gpsUnavailable?'gps_unavailable':outsideSite && inaccurateGps ? 'multiple'
        : outsideSite ? 'gps_outside' : inaccurateGps ? 'gps_inaccurate'
        : open.status === 'needs_review' || invalidDuration ? 'multiple' : null
      const { data: updated, error: updateError } = await admin.from('attendance_sessions').update({
        clock_out_at: now.toISOString(), clock_out_latitude: hasCoordinates?body.latitude:null,
        clock_out_longitude: hasCoordinates?body.longitude:null, clock_out_accuracy_meters: body.accuracy ?? null,
        clock_out_distance_meters: meters, clock_out_selfie_path: body.selfiePath,
        clock_out_device_id: attendanceDeviceId, clock_out_device_info: attendanceDeviceInfo,
        status, review_reason: reviewReason, review_category: reviewCategory,
        review_requested_at: status === 'needs_review' ? now.toISOString() : null,
        review_channel: status === 'needs_review' ? 'line_group' : null,
        ...(invalidDuration ? {
          calculation_status: 'needs_review', worked_minutes: null,
          normal_minutes: null, overtime_minutes: 0,
        } : {}),
      }).eq('company_id', companyId).eq('id', open.id).eq('profile_id', userId).is('clock_out_at', null).select('id').maybeSingle()
      if (updateError) throw updateError
      if (!updated) throw new Error('รายการนี้ลงเวลาออกแล้ว กรุณารีเฟรชหน้าจอ')
      attendanceId = open.id
    }

    const missingChannelFields=[
      ...(!hasCoordinates?['location']:[]),
      ...(!body.selfiePath?['selfie']:[]),
    ]
    const {data:channelRequest,error:channelRequestError}=await admin.from('attendance_channel_requests').upsert({
      company_id:companyId,
      channel:'web',
      external_event_id:`${attendanceId}:${body.action}`,
      profile_id:userId,
      site_id:site?.id??null,
      attendance_session_id:attendanceId,
      action:body.action,
      requested_at:now.toISOString(),
      latitude:hasCoordinates?body.latitude:null,
      longitude:hasCoordinates?body.longitude:null,
      accuracy_meters:body.accuracy??null,
      selfie_path:body.selfiePath,
      missing_fields:missingChannelFields,
      status:status==='needs_review'||missingChannelFields.length?'pending_review':'approved',
      confirmed_at:now.toISOString(),
      source_payload:{gps_error_code:gpsErrorCode,gps_error_message:gpsErrorMessage,device_id:attendanceDeviceId},
      updated_at:now.toISOString(),
    },{onConflict:'channel,external_event_id'}).select('id').maybeSingle()
    if(channelRequestError)console.error('Unable to sync Web attendance channel request',channelRequestError)
    else if(channelRequest?.id){
      const {error:channelEventError}=await admin.from('attendance_channel_events').insert({
        company_id:companyId,request_id:channelRequest.id,actor_profile_id:userId,event_type:'attendance_recorded',
        details:{attendance_session_id:attendanceId,status,missing_fields:missingChannelFields},
      })
      if(channelEventError)console.error('Unable to append Web attendance channel event',channelEventError)
    }

    const eventName = body.action === 'clock_in' ? 'ลงเวลาเข้างาน' : 'ลงเวลาออกงาน'
    const thaiTime = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
    const reviewText = status === 'needs_review'
      ? `\n⚠️ รับรายการแล้ว สถานะ: รอตรวจสอบ GPS\nError: ${gpsErrorCode??(inaccurateGps?'gps_inaccurate':'outside_site')}${gpsErrorMessage?` · ${gpsErrorMessage}`:''}\nระยะจากไซต์: ${finalDistance===null?'ไม่มีพิกัด':`${Math.round(finalDistance)} เมตร`}\nความแม่นยำ: ${Number.isFinite(body.accuracy)?`±${Math.round(Number(body.accuracy))} เมตร`:'ไม่มีข้อมูล'}\nเปิดตรวจสอบ: ${Deno.env.get('SITE_URL') ?? 'https://wisdomai-react.vercel.app'}/approvals?attendance_id=${attendanceId}`
      : ''
    const eventType = body.action === 'clock_in' ? 'clock_in' : 'clock_out'
    const { data: notification, error: notificationError } = await admin.from('attendance_notifications').upsert({
      company_id: companyId,
      session_id: attendanceId,
      event_type: eventType,
      channel: 'line',
      status: site?.line_group_id ? 'queued' : 'skipped',
      reason: site?.line_group_id ? null : 'site_has_no_line_group',
      updated_at: now.toISOString(),
    }, { onConflict: 'session_id,event_type,channel' }).select('id').single()
    if (notificationError) {
      console.error('Unable to create attendance notification', notificationError)
    }

    const notificationTask = async () => {
      if (!notification?.id || !site?.line_group_id) return
      const lineResult = await notifyLine(site.line_group_id,
        `✅ ${eventName}\nชื่อ: ${employeeName}\nโครงการ: ${site.projects?.name ?? '-'}\nไซต์: ${site.name}\nเวลา: ${thaiTime}\nมือถือของ: ${attendanceDeviceInfo.ownerName}\nอุปกรณ์: ${attendanceDeviceInfo.label}${reviewText}`)
      await admin.from('attendance_notifications').update({
        status: lineResult.status,
        reason: lineResult.reason ?? null,
        attempts: 1,
        sent_at: lineResult.status === 'sent' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('company_id', companyId).eq('id', notification.id)
    }
    const runtime = globalThis as unknown as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }
    if (runtime.EdgeRuntime?.waitUntil) runtime.EdgeRuntime.waitUntil(notificationTask())
    else void notificationTask()

    const lineText = site?.line_group_id
      ? 'ระบบรับรายการแจ้ง LINE เข้าคิวแล้ว'
      : 'ไซต์นี้ยังไม่ได้ผูกกลุ่ม LINE'
    return Response.json({
      ok: true,
      attendanceId,
      status,
      serverTime: now.toISOString(),
      lineNotification: { status: site?.line_group_id ? 'queued' : 'skipped' },
      message: status === 'needs_review'
        ? `รับข้อมูล${eventName}แล้ว เวลา ${thaiTime} สถานะรอตรวจสอบ GPS ${lineText}`
        : `${eventName}เรียบร้อย เวลา ${thaiTime} ${lineText}`,
    }, { headers: cors })
  } catch (error) {
    console.error(error)
    return Response.json({ error: error instanceof Error ? error.message : 'ไม่สามารถลงเวลาได้' }, { status: 400, headers: cors })
  }
})
