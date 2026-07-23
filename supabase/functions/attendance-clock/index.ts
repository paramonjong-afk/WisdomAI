import { createClient } from 'npm:@supabase/supabase-js@2'

type ClockBody = {
  action: 'clock_in' | 'clock_out'
  siteId?: string
  latitude: number
  longitude: number
  accuracy?: number
  selfiePath: string
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

async function notifyLine(groupId: string | null, message: string) {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
  if (!groupId || !token) return
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text: message }] }),
  })
  if (!response.ok) console.error('LINE push failed', response.status, await response.text())
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

    const userId = authData.user.id
    const { data: profile } = await admin.from('profiles').select('full_name,email,role').eq('id', userId).single()
    const isManager = profile?.role === 'admin' || profile?.role === 'manager'
    const now = new Date()
    let site: { id:string; name:string; latitude:number; longitude:number; radius_meters:number; line_group_id:string|null; projects:{name:string}|null } | null = null
    let attendanceId = ''
    let status = 'normal'

    if (body.action === 'clock_in') {
      if (!body.siteId) throw new Error('กรุณาเลือกไซต์')
      const { data, error } = await admin.from('project_sites')
        .select('id,name,latitude,longitude,radius_meters,line_group_id,projects(name)')
        .eq('id', body.siteId).eq('active', true).single()
      if (error || !data) throw new Error('ไม่พบไซต์ที่เลือก')
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
      const { data: created, error } = await admin.from('attendance_sessions').insert({
        profile_id: userId, site_id: site.id, clock_in_at: now.toISOString(),
        clock_in_latitude: body.latitude, clock_in_longitude: body.longitude,
        clock_in_accuracy_meters: body.accuracy ?? null, clock_in_distance_meters: meters,
        clock_in_selfie_path: body.selfiePath, status,
      }).select('id').single()
      if (error) throw error
      attendanceId = created.id
    } else {
      const { data: open, error: openError } = await admin.from('attendance_sessions')
        .select('id,site_id,project_sites(id,name,latitude,longitude,radius_meters,line_group_id,projects(name))')
        .eq('profile_id', userId).is('clock_out_at', null).maybeSingle()
      if (openError || !open) throw new Error('ไม่พบรายการลงเวลาเข้าที่ยังเปิดอยู่')
      site = open.project_sites as unknown as typeof site
      if (!site) throw new Error('ไม่พบข้อมูลไซต์')
      const meters = distanceMeters(body.latitude, body.longitude, site.latitude, site.longitude)
      status = meters <= site.radius_meters ? 'normal' : 'needs_review'
      const { error } = await admin.from('attendance_sessions').update({
        clock_out_at: now.toISOString(), clock_out_latitude: body.latitude,
        clock_out_longitude: body.longitude, clock_out_accuracy_meters: body.accuracy ?? null,
        clock_out_distance_meters: meters, clock_out_selfie_path: body.selfiePath,
        status,
      }).eq('id', open.id).eq('profile_id', userId).is('clock_out_at', null)
      if (error) throw error
      attendanceId = open.id
    }

    const employee = profile?.full_name || profile?.email || authData.user.email || 'พนักงาน'
    const eventName = body.action === 'clock_in' ? 'ลงเวลาเข้างาน' : 'ลงเวลาออกงาน'
    const thaiTime = now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
    const reviewText = status === 'needs_review' ? '\n⚠️ อยู่นอกรัศมีไซต์ กรุณาตรวจสอบ' : ''
    await notifyLine(site?.line_group_id ?? null,
      `✅ ${eventName}\nชื่อ: ${employee}\nโครงการ: ${site?.projects?.name ?? '-'}\nไซต์: ${site?.name ?? '-'}\nเวลา: ${thaiTime}${reviewText}`)

    return Response.json({ ok: true, attendanceId, status, serverTime: now.toISOString() }, { headers: cors })
  } catch (error) {
    console.error(error)
    return Response.json({ error: error instanceof Error ? error.message : 'ไม่สามารถลงเวลาได้' }, { status: 400, headers: cors })
  }
})
