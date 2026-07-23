import { createClient } from 'npm:@supabase/supabase-js@2'

type ClockBody = {
  action: 'clock_in' | 'clock_out'
  siteId?: string
  latitude: number
  longitude: number
  accuracy?: number
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

type LineNotification = {
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

async function notifyLine(groupId: string | null, message: string): Promise<LineNotification> {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!groupId) return { status: 'skipped', reason: 'site_has_no_line_group' }
  if (!token) return { status: 'failed', reason: 'missing_line_channel_access_token' }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: message }] }),
    })
    if (response.ok) return { status: 'sent' }

    const detail = await response.text()
    console.error('LINE push failed', response.status, detail)
    return { status: 'failed', reason: `line_api_${response.status}: ${detail}` }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('LINE push request failed', detail)
    return { status: 'failed', reason: `line_request_failed: ${detail}` }
  }
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

    const body = await request.json() as ClockBody
    if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude) || !body.selfiePath) {
      return Response.json({ error: 'ข้อมูลพิกัดหรือรูปถ่ายไม่ครบ' }, { status: 400, headers: cors })
    }
    if (!Number.isFinite(body.accuracy) || Number(body.accuracy) > 1_000) {
      return Response.json({
        error: `ตำแหน่งไม่แม่นยำ (คลาดเคลื่อนประมาณ ${Math.round(Number(body.accuracy) || 0).toLocaleString('th-TH')} เมตร) กรุณาเปิด GPS แบบแม่นยำและลองใหม่`,
      }, { status: 400, headers: cors })
    }

    const userId = authData.user.id
    const { data: profile } = await admin.from('profiles').select('full_name,email,role').eq('id', userId).single()
    const employeeName = profile?.full_name?.trim()
    if (!employeeName) {
      return Response.json({
        error: 'ยังไม่ได้ระบุชื่อพนักงาน กรุณาเปิดเมนู Employees เพื่อบันทึกชื่อก่อนลงเวลา',
      }, { status: 400, headers: cors })
    }
    const isManager = profile?.role === 'admin' || profile?.role === 'manager'
    const attendanceDeviceId = cleanText(body.device?.id, 100) || null
    const attendanceDeviceInfo = deviceInfo(body.device)
    const now = new Date()
    let site: { id:string; name:string; latitude:number; longitude:number; radius_meters:number; line_group_id:string|null; projects:{name:string}|null } | null = null
    let attendanceId = ''
    let status = 'normal'

    if (body.action === 'clock_in') {
      if (!body.siteId) throw new Error('กรุณาเลือกไซต์')
      const { data: existingOpen, error: existingOpenError } = await admin
        .from('attendance_sessions')
        .select('id,clock_in_at,project_sites(name)')
        .eq('profile_id', userId)
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingOpenError) throw existingOpenError
      if (existingOpen) {
        const existingTime = new Date(existingOpen.clock_in_at).toLocaleString('th-TH', {
          timeZone: 'Asia/Bangkok',
          dateStyle: 'medium',
          timeStyle: 'short',
        })
        const existingSite = (existingOpen.project_sites as unknown as { name?: string } | null)?.name ?? '-'
        throw new Error(`คุณลงเวลาเข้าแล้ว เวลา ${existingTime} ที่ไซต์ ${existingSite} กรุณาลงเวลาออกก่อน`)
      }

      const { data, error: siteError } = await admin.from('project_sites')
        .select('id,name,latitude,longitude,radius_meters,line_group_id,projects(name)')
        .eq('id', body.siteId).eq('active', true).single()
      if (siteError || !data) throw new Error('ไม่พบไซต์ที่เลือก')
      site = data as unknown as typeof site

      if (!isManager) {
        const { data: assignment } = await admin.from('employee_site_assignments').select('site_id')
          .eq('profile_id', userId).eq('site_id', body.siteId).eq('active', true)
          .lte('starts_on', now.toISOString().slice(0, 10))
          .or(`ends_on.is.null,ends_on.gte.${now.toISOString().slice(0, 10)}`).maybeSingle()
        if (!assignment) throw new Error('คุณยังไม่ได้รับมอบหมายให้ไซต์นี้')
      }

      const meters = distanceMeters(body.latitude, body.longitude, site.latitude, site.longitude)
      status = meters <= site.radius_meters ? 'normal' : 'needs_review'
      const { data: created, error: insertError } = await admin.from('attendance_sessions').insert({
        profile_id: userId, site_id: site.id, clock_in_at: now.toISOString(),
        clock_in_latitude: body.latitude, clock_in_longitude: body.longitude,
        clock_in_accuracy_meters: body.accuracy ?? null, clock_in_distance_meters: meters,
        clock_in_selfie_path: body.selfiePath, status,
        clock_in_device_id: attendanceDeviceId, clock_in_device_info: attendanceDeviceInfo,
      }).select('id').single()
      if (insertError?.code === '23505') {
        throw new Error('คุณลงเวลาเข้าแล้ว กรุณาลงเวลาออกก่อน')
      }
      if (insertError) throw insertError
      attendanceId = created.id
    } else {
      const { data: open, error: openError } = await admin.from('attendance_sessions')
        .select('id,site_id,project_sites(id,name,latitude,longitude,radius_meters,line_group_id,projects(name))')
        .eq('profile_id', userId)
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openError) throw openError
      if (!open) throw new Error('ไม่พบรายการที่กำลังทำงาน หรือคุณได้ลงเวลาออกแล้ว')
      site = open.project_sites as unknown as typeof site
      if (!site) throw new Error('ไม่พบข้อมูลไซต์')
      const meters = distanceMeters(body.latitude, body.longitude, site.latitude, site.longitude)
      status = meters <= site.radius_meters ? 'normal' : 'needs_review'
      const { data: updated, error: updateError } = await admin.from('attendance_sessions').update({
        clock_out_at: now.toISOString(), clock_out_latitude: body.latitude,
        clock_out_longitude: body.longitude, clock_out_accuracy_meters: body.accuracy ?? null,
        clock_out_distance_meters: meters, clock_out_selfie_path: body.selfiePath,
        clock_out_device_id: attendanceDeviceId, clock_out_device_info: attendanceDeviceInfo,
        status,
      }).eq('id', open.id).eq('profile_id', userId).is('clock_out_at', null).select('id').maybeSingle()
      if (updateError) throw updateError
      if (!updated) throw new Error('รายการนี้ลงเวลาออกแล้ว กรุณารีเฟรชหน้าจอ')
      attendanceId = open.id
    }

    const eventName = body.action === 'clock_in' ? 'ลงเวลาเข้างาน' : 'ลงเวลาออกงาน'
    const thaiTime = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
    const reviewText = status === 'needs_review' ? '\n⚠️ อยู่นอกรัศมีไซต์ กรุณาตรวจสอบ' : ''
    const lineNotification = await notifyLine(site?.line_group_id ?? null,
      `✅ ${eventName}\nชื่อ: ${employeeName}\nโครงการ: ${site?.projects?.name ?? '-'}\nไซต์: ${site?.name ?? '-'}\nเวลา: ${thaiTime}\nมือถือของ: ${attendanceDeviceInfo.ownerName}\nอุปกรณ์: ${attendanceDeviceInfo.label}${reviewText}`)

    return Response.json({ ok: true, attendanceId, status, serverTime: now.toISOString(), lineNotification }, { headers: cors })
  } catch (error) {
    console.error(error)
    return Response.json({ error: error instanceof Error ? error.message : 'ไม่สามารถลงเวลาได้' }, { status: 400, headers: cors })
  }
})
