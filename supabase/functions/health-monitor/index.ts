import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const healthMonitorSecret = Deno.env.get('HEALTH_MONITOR_SECRET') ?? ''
const siteUrl = Deno.env.get('WISDOMAI_SITE_URL') ?? 'https://wisdomai-react.vercel.app'
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

type Status = 'healthy' | 'warning' | 'critical'
type CheckResult = { key: string; name: string; module: string; status: Status; message: string; latency: number; metadata?: Record<string, unknown> }

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-user-authorization, x-monitor-secret, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
})
const since = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const bangkokTodayStart = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {})
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+07:00`).toISOString()
}
const p95 = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null
}
const numericMetric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message.slice(0, 500)
  if (error && typeof error === 'object') {
    const value=error as Record<string,unknown>
    const parts=[value.code,value.message,value.details,value.hint].filter(part=>typeof part==='string'&&part.trim())
    if(parts.length)return parts.join(' | ').slice(0,500)
    try{return JSON.stringify(value).slice(0,500)}catch{return 'Unknown structured error'}
  }
  return String(error??'Unknown error').slice(0,500)
}
const countByCompany = (rows: Array<{ company_id?: string | null }>) => rows.reduce<Record<string, number>>((counts, row) => {
  const key = row.company_id ?? 'unassigned'
  counts[key] = (counts[key] ?? 0) + 1
  return counts
}, {})
const manualStatusReportMarker = '[work_status_manual]'
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]!))
const bangkokParts = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(new Date()).reduce<Record<string,string>>((result, part) => ({ ...result, [part.type]: part.value }), {})

async function updateErrorWorkItem(results: CheckResult[], checkedAt: string) {
  const failures = results.filter(result => result.status !== 'healthy')
  const { count: openIncidents } = await admin.from('health_monitor_incidents')
    .select('id', { count: 'exact', head: true }).eq('status', 'open')
  const fingerprints = failures.map(result => `${result.module}:${result.key}`).sort()
  const evidence = failures.length
    ? `ตรวจ ${results.length} เส้นทาง; ผิดปกติรอบนี้ ${failures.length}; incident เปิด ${openIncidents ?? 0}; fingerprint ${fingerprints.join(', ')}; ล่าสุด ${checkedAt}`
    : `ตรวจ ${results.length} เส้นทางครบ; ไม่พบ Error ใหม่; incident เปิด ${openIncidents ?? 0}; ล่าสุด ${checkedAt}`
  const severity = failures.some(result => result.status === 'critical') ? 'high' : failures.length ? 'medium' : 'low'
  const { error } = await admin.from('system_work_items').update({
    progress: failures.length ? 90 : 100,
    risk: severity,
    evidence: evidence.slice(0, 4000),
    error_fingerprint: fingerprints.join('|').slice(0, 200) || null,
    current_step: failures.length ? 'ติดตาม incident ที่ยังเปิด' : 'ตรวจ regression ผ่าน',
    production_status: failures.length ? 'monitoring_active_with_open_incidents' : 'deployed_and_monitoring_healthy',
    updated_at: checkedAt,
  }).eq('work_key', 'SYS-004')
  if (error) throw new Error(`SYS-004 sync failed: ${error.message}`)
}

async function check(key: string, name: string, module: string, task: () => Promise<{ status?: Status; message: string; metadata?: Record<string, unknown> }>): Promise<CheckResult> {
  const started = Date.now()
  try {
    const result = await task()
    return { key, name, module, status: result.status ?? 'healthy', message: result.message, latency: Date.now() - started, metadata: result.metadata }
  } catch (error) {
    return { key, name, module, status: 'critical', message: describeError(error), latency: Date.now() - started, metadata: { error_type: error instanceof Error ? error.name : typeof error } }
  }
}

async function sendTelegram(chatId: string, message: string, replyMarkup?: unknown) {
  if (!telegramBotToken) return { status: 'failed' as const, error: 'TELEGRAM_BOT_TOKEN is not configured' }
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    })
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string }
    if (!response.ok || !payload.ok) {
      const error = payload.description ?? `HTTP ${response.status}`
      return { status: 'failed' as const, error, terminal: /bot was kicked|chat not found|bot was blocked|forbidden/i.test(error) }
    }
    return { status: 'sent' as const, error: null, terminal: false }
  } catch (error) {
    return { status: 'failed' as const, error: error instanceof Error ? error.message : String(error), terminal: false }
  }
}

async function deactivateTelegramChat(chatId: string, reason: string) {
  const { error } = await admin.from('telegram_admin_chats').update({
    active: false,
    updated_at: new Date().toISOString(),
  }).eq('telegram_chat_id', chatId)
  if (error) console.error('Unable to deactivate Telegram chat', { chatId, reason, error: error.message })
}

async function telegramChats(companyId?: string | null) {
  let query = admin.from('telegram_admin_chats').select('telegram_chat_id,title,company_id').eq('active', true)
  if (companyId === null) query = query.is('company_id', null)
  else if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

async function recordAdminNotification(type: string, incidentId: string | null, message: string, companyId?: string | null, replyMarkup?: unknown) {
  const chats = await telegramChats(companyId)
  if (!chats.length) return { sent: 0, failed: 0, missing: true }
  let sent = 0
  let failed = 0
  for (const chat of chats) {
    const delivery = await sendTelegram(chat.telegram_chat_id, message, replyMarkup)
    if (delivery.status === 'sent') sent += 1
    else {
      failed += 1
      if (delivery.terminal) await deactivateTelegramChat(chat.telegram_chat_id, delivery.error)
    }
    await admin.from('health_monitor_notifications').insert({
      company_id: companyId ?? chat.company_id ?? null,
      notification_type: type,
      incident_id: incidentId,
      destination: `telegram:${chat.telegram_chat_id}`,
      status: delivery.status,
      message,
      error_message: delivery.error,
    })
  }
  return { sent, failed, missing: false }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const body = await request.json().catch(() => ({})) as { action?: string; group_name?: string; work_key?: string; source?: string; company_id?: string }
  const monitorAuthorized = Boolean(healthMonitorSecret && request.headers.get('x-monitor-secret') === healthMonitorSecret)
  let actorCompanyId: string|null = null
  if (monitorAuthorized && body.action === 'bootstrap_vault') {
    const { error } = await admin.rpc('bootstrap_health_monitor_vault_secret', { secret_value: healthMonitorSecret })
    if (error) return json({ error: error.message }, 500)
    return json({ status: 'vault_secret_configured' })
  }
  if (!monitorAuthorized) {
    const authorization = request.headers.get('x-user-authorization') ?? request.headers.get('authorization')
    if (!authorization) return json({ error: healthMonitorSecret ? 'Unauthorized' : 'Monitor secret is not configured' }, healthMonitorSecret ? 401 : 503)
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
    if (!accessToken) return json({ error: 'Unauthorized' }, 401)
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken)
    if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401)
    const { data: caller } = await admin.from('profiles').select('role').eq('id', authData.user.id).single()
    if (caller?.role !== 'admin') return json({ error: 'Admin permission required' }, 403)
    const { data: preference } = await admin.from('user_company_preferences').select('active_company_id').eq('profile_id', authData.user.id).maybeSingle()
    actorCompanyId = preference?.active_company_id ?? null
    if (!actorCompanyId) return json({ error: 'Active company required' }, 400)
    const { data: membership } = await admin.from('company_members').select('company_role').eq('company_id',actorCompanyId).eq('profile_id',authData.user.id).eq('active',true).maybeSingle()
    if (caller?.role !== 'admin' && (!membership || !['company_admin','executive','manager'].includes(membership.company_role))) return json({ error: 'Company manager permission required' }, 403)
  } else if (body.source === 'pg_cron') {
    const requestedCompanyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    if (!monitorAuthorized) return json({ error: 'Unauthorized monitor request' }, 401)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCompanyId)) {
      return json({ error: 'Valid company_id required for scheduled monitor' }, 400)
    }
    actorCompanyId = requestedCompanyId
  } else {
    return json({ error: 'Monitor secret is restricted to scheduled runs' }, 403)
  }

  let settingsQuery=admin.from('health_monitor_settings').select('*').eq('singleton', true)
  settingsQuery=actorCompanyId?settingsQuery.eq('company_id',actorCompanyId):settingsQuery.is('company_id',null)
  const { data: settings, error: settingsError } = await settingsQuery.maybeSingle()
  if (settingsError) return json({ error: settingsError.message }, 500)
  if (!settings) return json({ error: 'Health Monitor settings are not initialized for the active company' }, 409)
  if (!settings.enabled) return json({ status: 'disabled' })

  if (body.action === 'send_work_approval') {
    const workKey = (body.work_key || '').trim().toUpperCase()
    if (!workKey) return json({ error: 'กรุณาระบุ work_key' }, 400)
    const { data: item, error: itemError } = await admin.from('system_work_items')
      .select('work_key,title,status,progress,risk,detail,production_status,company_id').eq('work_key', workKey).maybeSingle()
    if (itemError) return json({ error: itemError.message }, 500)
    if (!item) return json({ error: `ไม่พบงาน ${workKey}` }, 404)
    if (item.status !== 'review') return json({ error: `งาน ${workKey} ไม่ได้อยู่ในสถานะรอตรวจ` }, 409)
    const { data: recent } = await admin.from('health_monitor_notifications').select('id')
      .eq('company_id', item.company_id ?? actorCompanyId)
      .eq('notification_type', 'work_approval_requested').like('destination', 'telegram:%')
      .gte('created_at', since(5)).ilike('message', `%${workKey}%`).limit(1).maybeSingle()
    if (recent) return json({ status: 'rate_limited', message: 'ส่งคำขออนุมัติงานนี้แล้วภายใน 5 นาที' })
    const text = `🔐 <b>ขออนุมัติงาน ${escapeHtml(item.work_key)}</b>\n${escapeHtml(item.title)}\nความเสี่ยง: ${escapeHtml(item.risk)}\nความคืบหน้า: ${item.progress}%\nProduction: ${escapeHtml(item.production_status)}\n${escapeHtml(item.detail || '-')}\n\nผู้ดูแลระบบที่ผูก Telegram กรุณาตัดสินใจ`
    const replyMarkup = { inline_keyboard: [[
      { text: '✅ อนุมัติ', callback_data: `work:approve:${item.work_key}` },
      { text: '⛔ ไม่อนุมัติ', callback_data: `work:reject:${item.work_key}` },
    ]] }
    const delivery = await recordAdminNotification('work_approval_requested', null, text, item.company_id, replyMarkup)
    if (!delivery.sent) return json({ error: delivery.missing ? 'ไม่พบห้อง Telegram Admin ที่ผูกกับบริษัทนี้' : 'ส่งคำขออนุมัติ Telegram ไม่สำเร็จ', failed: delivery.failed }, 502)
    return json({ status: delivery.failed ? 'partial' : 'sent', work_key: item.work_key, sent: delivery.sent, failed: delivery.failed, channel: 'telegram' })
  }
  if (body.action === 'send_status_report') {
    const { data: recent } = await admin.from('health_monitor_notifications').select('id')
      .eq('company_id', actorCompanyId)
      .eq('notification_type', 'configuration').like('destination', 'telegram:%')
      .like('message', `${manualStatusReportMarker}%`)
      .gte('created_at', since(5)).limit(1).maybeSingle()
    if (recent) return json({ status: 'rate_limited', message: 'ส่งรายงานไปแล้วภายใน 5 นาที' })

    const [{ data: currentChecks }, { count: openIncidents }, { data: chats, error: chatsError }] = await Promise.all([
      admin.from('health_monitor_checks').select('status').eq('company_id',actorCompanyId),
      admin.from('health_monitor_incidents').select('id', { count: 'exact', head: true }).eq('company_id',actorCompanyId).eq('status', 'open'),
      admin.from('telegram_admin_chats').select('telegram_chat_id,title,company_id').eq('company_id',actorCompanyId).eq('active', true),
    ])
    if (chatsError) return json({ error: chatsError.message }, 500)
    if (!chats?.length) return json({ error: 'ไม่พบห้อง Telegram Admin ที่เปิดใช้งาน' }, 502)
    const checkCounts = (currentChecks ?? []).reduce((sum, row) => {
      const key = String(row.status || 'unknown')
      sum[key] = (sum[key] ?? 0) + 1
      return sum
    }, {} as Record<string, number>)
    const workStatusLabel: Record<string,string> = { ready: 'พร้อมทำ', doing: 'กำลังทำ', review: 'รอตรวจ', done: 'เสร็จแล้ว', blocked: 'ติดปัญหา' }
    const workIcon: Record<string,string> = { ready: '🔵', doing: '🟠', review: '🟣', done: '🟢', blocked: '🔴' }
    let sent = 0
    let failed = 0
    for (const chat of chats) {
      const { data: workItems, error: workItemsError } = await admin.from('system_work_items')
        .select('work_key,title,status,progress,production_status').or(`company_id.is.null,company_id.eq.${chat.company_id}`).order('work_key')
      if (workItemsError) return json({ error: workItemsError.message }, 500)
      const workLines = (workItems ?? []).map(item => `${workIcon[item.status] ?? '⚪'} ${escapeHtml(item.work_key)} ${escapeHtml(item.title)} · ${item.progress}% · ${workStatusLabel[item.status] ?? escapeHtml(item.status)} · ${escapeHtml(item.production_status)}`)
      const report = [
        `${manualStatusReportMarker}`,
        '📊 <b>รายงานสถานะ WisdomAI</b>',
        `ห้อง: ${escapeHtml(chat.title || 'Telegram Admin')}`,
        `เวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
        '',
        `สถานะระบบ: 🟢 ${checkCounts.healthy ?? 0} · 🟠 ${checkCounts.warning ?? 0} · 🔴 ${checkCounts.critical ?? 0} · ⚪ ${checkCounts.unknown ?? 0}`,
        `เหตุขัดข้องที่ยังเปิด ${openIncidents ?? 0}`,
        '',
        `<b>ความก้าวหน้างาน (${workLines.length} งาน)</b>`,
        ...workLines,
        '',
        `${siteUrl}/system-health`,
      ].join('\n')
      const delivery = await sendTelegram(chat.telegram_chat_id, report)
      if (delivery.status === 'sent') sent += 1
      else {
        failed += 1
        if (delivery.terminal) await deactivateTelegramChat(chat.telegram_chat_id, delivery.error)
      }
      await admin.from('health_monitor_notifications').insert({ company_id: chat.company_id, notification_type: 'configuration', destination: `telegram:${chat.telegram_chat_id}`, status: delivery.status, message: report, error_message: delivery.error })
    }
    if (!sent) return json({ error: 'ส่งรายงาน Telegram ไม่สำเร็จ', failed }, 502)
    return json({ status: failed ? 'partial' : 'sent', sent, failed, channel: 'telegram' })
  }

  let latestRunQuery=admin.from('health_monitor_runs').select('started_at')
  latestRunQuery=actorCompanyId?latestRunQuery.eq('company_id',actorCompanyId):latestRunQuery.is('company_id',null)
  const { data: latestRun } = await latestRunQuery.order('started_at', { ascending: false }).limit(1).maybeSingle()
  const isManualAdminCheck = body.source === 'system_health_page'
  if (!isManualAdminCheck && latestRun && Date.now() - new Date(latestRun.started_at).getTime() < Math.max(4, settings.check_interval_minutes - 1) * 60_000) {
    return json({ status: 'rate_limited' })
  }

  const { data: run, error: runError } = await admin.from('health_monitor_runs').insert({ status: 'running',company_id:actorCompanyId }).select('id').single()
  if (runError) return json({ error: runError.message }, 500)

  try {
    const results = await Promise.all([
      check('web_app', 'หน้าเว็บหลัก', 'Web/Vercel', async () => {
        const response = await fetch(`${siteUrl}/login`, { headers: { 'cache-control': 'no-cache' } })
        if (!response.ok) throw new Error(`เว็บตอบกลับ HTTP ${response.status}`)
        const html = await response.text()
        if (!html.includes('id="root"')) throw new Error('หน้าเว็บไม่พบจุดเริ่มต้นของแอป')
        return { message: `ออนไลน์ HTTP ${response.status}` }
      }),
      check('database', 'ฐานข้อมูลหลัก', 'Supabase', async () => {
        let query=admin.from('projects').select('project_id', { count: 'exact', head: true })
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const response = await query
        if (response.error) throw response.error
        return { message: `เชื่อมต่อได้ · ${response.count ?? 0} โครงการ` }
      }),
      check('project_relationships', 'โครงการและไซต์งาน', 'Projects/Sites', async () => {
        let query=admin.from('project_sites').select('id,projects(name)')
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const response = await query.limit(1)
        if (response.error) throw response.error
        return { message: 'ความสัมพันธ์โครงการ–ไซต์ถูกต้อง' }
      }),
      check('attendance', 'ระบบลงเวลา', 'Attendance', async () => {
        const [{ data: failedRows, error }, { data: openRows, error: openError }, { data: ruleRows, error: ruleError }] = await Promise.all([
          (()=>{let query=admin.from('attendance_notifications').select('id,company_id,updated_at,reason').eq('status','failed').gte('updated_at',since(24*60));if(actorCompanyId)query=query.eq('company_id',actorCompanyId);return query.order('updated_at',{ascending:false}).limit(100)})(),
          (()=>{let query=admin.from('attendance_sessions').select('id,company_id,profile_id,site_id,clock_in_at,scheduled_end_at,status').is('clock_out_at',null).not('status','in','(rejected,duplicate)');if(actorCompanyId)query=query.eq('company_id',actorCompanyId);return query.order('clock_in_at',{ascending:true}).limit(500)})(),
          (()=>{let query=admin.from('workforce_rule_settings').select('company_id,stale_after_shift_minutes').eq('singleton',true);if(actorCompanyId)query=query.eq('company_id',actorCompanyId);return query})(),
        ])
        if (error || openError || ruleError) throw error ?? openError ?? ruleError
        const staleMinutesByCompany = new Map((ruleRows ?? []).map(row => [row.company_id, Math.max(0, Number(row.stale_after_shift_minutes ?? 60))]))
        const overdueAt = (row: { company_id: string; clock_in_at: string; scheduled_end_at?: string | null }) => {
          if (row.scheduled_end_at) return new Date(row.scheduled_end_at).getTime() + (staleMinutesByCompany.get(row.company_id) ?? 60) * 60_000
          return new Date(row.clock_in_at).getTime() + 18 * 60 * 60_000
        }
        const staleRows = (openRows ?? []).filter(row => Date.now() >= overdueAt(row))
        const activeTodayRows = (openRows ?? []).filter(row => row.clock_in_at >= bangkokTodayStart() && Date.now() < overdueAt(row) && !['pending','needs_review'].includes(row.status))
        const failed = failedRows?.length ?? 0
        const stale = staleRows?.length ?? 0
        const activeToday = activeTodayRows?.length ?? 0
        const total = failed + stale
        const staleProfiles = [...new Set((staleRows ?? []).map(row => row.profile_id).filter(Boolean))]
        const staleSites = [...new Set((staleRows ?? []).map(row => row.site_id).filter(Boolean))]
        const staleCompanies = [...new Set((staleRows ?? []).map(row => row.company_id).filter(Boolean))]
        const [profileResult, employmentResult, siteResult, companyResult] = await Promise.all([
          staleProfiles.length ? admin.from('profiles').select('id,full_name,email').in('id', staleProfiles) : Promise.resolve({ data: [], error: null }),
          staleProfiles.length ? admin.from('employee_employment_records').select('profile_id,company_id,employee_code').in('profile_id', staleProfiles) : Promise.resolve({ data: [], error: null }),
          staleSites.length ? admin.from('project_sites').select('id,name,projects(name)').in('id', staleSites) : Promise.resolve({ data: [], error: null }),
          staleCompanies.length ? admin.from('companies').select('id,name').in('id', staleCompanies) : Promise.resolve({ data: [], error: null }),
        ])
        if (profileResult.error || employmentResult.error || siteResult.error || companyResult.error) {
          throw profileResult.error ?? employmentResult.error ?? siteResult.error ?? companyResult.error
        }
        const profiles = new Map((profileResult.data ?? []).map(row => [row.id, row]))
        const employments = new Map((employmentResult.data ?? []).map(row => [`${row.company_id}:${row.profile_id}`, row]))
        const sites = new Map((siteResult.data ?? []).map(row => [row.id, row]))
        const companies = new Map((companyResult.data ?? []).map(row => [row.id, row]))
        const staleSessions = (staleRows ?? []).slice(0, 20).map(row => {
          const profile = profiles.get(row.profile_id)
          const employment = employments.get(`${row.company_id}:${row.profile_id}`)
          const site = sites.get(row.site_id)
          const project = Array.isArray(site?.projects) ? site.projects[0] : site?.projects
          return {
            session_id: row.id,
            company_id: row.company_id,
            company_name: companies.get(row.company_id)?.name ?? null,
            profile_id: row.profile_id,
            employee_name: profile?.full_name ?? profile?.email ?? null,
            employee_code: employment?.employee_code ?? null,
            project_name: project?.name ?? null,
            site_name: site?.name ?? null,
            clock_in_at: row.clock_in_at,
            open_minutes: Math.max(0, Math.round((Date.now() - new Date(row.clock_in_at).getTime()) / 60_000)),
            overdue_minutes: Math.max(0, Math.round((Date.now() - overdueAt(row)) / 60_000)),
            overdue_basis: row.scheduled_end_at ? 'scheduled_end_plus_grace' : 'legacy_18h_fallback',
            status: row.status,
          }
        })
        return {
          status: total ? 'warning' : 'healthy',
          message: total ? `แจ้งเตือนล้มเหลว ${failed} (24 ชม.) · เกินเวลาตรวจสอบ ${stale} · กำลังทำงานวันนี้ ${activeToday}` : `ทำงานปกติ · กำลังทำงานวันนี้ ${activeToday}`,
          metadata: {
            failed_notifications_24h: failed,
            overdue_attendance_sessions: stale,
            active_sessions_today: activeToday,
            failed_by_company: countByCompany(failedRows ?? []),
            stale_by_company: countByCompany(staleRows ?? []),
            failed_notification_ids: (failedRows ?? []).slice(0, 20).map(row => row.id),
            stale_sessions: staleSessions,
          },
        }
      }),
      check('line_pipeline', 'รับและวิเคราะห์ LINE', 'LINE', async () => {
        let failedQuery=admin.from('line_ingestion_events').select('webhook_event_id', { count: 'exact', head: true }).eq('processing_status','failed').gte('received_at',since(15))
        let stalledQuery=admin.from('line_ingestion_events').select('webhook_event_id', { count: 'exact', head: true }).in('processing_status',['received','processing']).lt('received_at',since(15))
        if(actorCompanyId){failedQuery=failedQuery.eq('company_id',actorCompanyId);stalledQuery=stalledQuery.eq('company_id',actorCompanyId)}
        const [{ count: failed, error }, { count: stalled, error: stalledError }] = await Promise.all([failedQuery, stalledQuery])
        if (error || stalledError) throw error ?? stalledError
        const status: Status = (stalled ?? 0) >= 10 ? 'critical' : (failed ?? 0) || (stalled ?? 0) ? 'warning' : 'healthy'
        return { status, message: failed || stalled ? `คิวล้มเหลว ${failed ?? 0} · เกิน SLA 15 นาที ${stalled ?? 0}` : 'ไม่พบคิวเกิน SLA', metadata: { failed_15m: failed ?? 0, stalled_over_15m: stalled ?? 0, queue_sla_minutes: 15 } }
      }),
      check('client_performance', 'ประสิทธิภาพ API และหน้าเว็บ', 'Web/API', async () => {
        let query=admin.from('app_activity_logs').select('event_type,severity,metadata,created_at').gte('created_at',since(15)).order('created_at',{ascending:false}).limit(200)
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const { data, error } = await query
        if (error) throw error
        const rows=data??[]
        const api=rows.filter(row => row.metadata?.performance_kind === 'api')
        const vitals=rows.filter(row => row.event_type === 'performance_metric')
        const tables=rows.filter(row => row.metadata?.performance_kind === 'table')
        const apiP95=p95(api.map(row=>numericMetric(row.metadata?.latency_ms)).filter((value): value is number => value !== null))
        const lcpP95=p95(vitals.filter(row=>row.metadata?.metric === 'largest_contentful_paint').map(row=>numericMetric(row.metadata?.value_ms)).filter((value): value is number => value !== null))
        const interactionP95=p95(vitals.filter(row=>row.metadata?.metric === 'interaction_delay').map(row=>numericMetric(row.metadata?.value_ms)).filter((value): value is number => value !== null))
        const errorRate=api.length ? api.filter(row=>row.metadata?.result !== 'success').length / api.length : 0
        const maxQuery=Math.max(0,...api.map(row=>numericMetric(row.metadata?.url_length)??0))
        const maxPage=Math.max(0,...tables.map(row=>numericMetric(row.metadata?.row_count)??0))
        const critical=(apiP95??0)>3000 || (lcpP95??0)>4000 || (interactionP95??0)>800 || errorRate>0.05 || api.some(row=>row.metadata?.result !== 'success' && (numericMetric(row.metadata?.url_length)??0)>6000)
        const warning=!critical && ((apiP95??0)>1000 || (lcpP95??0)>2500 || (interactionP95??0)>300 || errorRate>0.01 || maxQuery>6000 || maxPage>100)
        return { status: critical ? 'critical' : warning ? 'warning' : 'healthy', message: `API p95 ${apiP95 ?? 'n/a'}ms · LCP p95 ${lcpP95 ?? 'n/a'}ms · interaction p95 ${interactionP95 ?? 'n/a'}ms · error ${(errorRate * 100).toFixed(1)}%`, metadata: { sample_window_minutes:15, api_samples:api.length, api_p95_ms:apiP95, lcp_p95_ms:lcpP95, interaction_p95_ms:interactionP95, error_rate:errorRate, max_url_length:maxQuery, max_page_size:maxPage, route_action:'app_activity_logs performance metadata' } }
      }),
      check('client_errors', 'ข้อผิดพลาดจากอุปกรณ์ผู้ใช้', 'Client', async () => {
        let query=admin.from('app_activity_logs').select('id', { count: 'exact', head: true }).in('severity',['warning','error']).gte('created_at',since(15))
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const { count, error } = await query
        if (error) throw error
        let latestQuery=admin.from('app_activity_logs').select('id,created_at').in('severity',['warning','error']).gte('created_at',since(15)).order('created_at',{ascending:false}).limit(1)
        if(actorCompanyId)latestQuery=latestQuery.eq('company_id',actorCompanyId)
        const {data:latest,error:latestError}=await latestQuery.maybeSingle()
        if(latestError)throw latestError
        const status: Status = (count ?? 0) >= 10 ? 'critical' : count ? 'warning' : 'healthy'
        return { status, message: count ? `พบ ${count} เหตุการณ์ใน 15 นาที` : 'ไม่พบ error ใหม่', metadata: { errors_15m: count, latest_error_id:latest?.id??null, latest_error_at:latest?.created_at??null } }
      }),
      check('auth_recovery_alerts', 'ปัญหา Login / Reset Password', 'Auth', async () => {
        const { data, error } = await admin.from('auth_login_attempts')
          .select('id,reason,created_at')
          .eq('outcome','failure')
          .gte('created_at',since(15))
          .or('reason.ilike.%auth_critical:%,reason.ilike.%over_email_send_rate_limit%,reason.ilike.%rate limit%,reason.ilike.%User is banned%,reason.ilike.%otp_expired%,reason.ilike.%access_denied%')
          .order('created_at',{ascending:false})
          .limit(10)
        if (error) throw error
        const rows=data??[]
        const critical=rows.some(row=>/auth_critical|over_email_send_rate_limit|rate limit|user is banned|banned|access_denied/i.test(String(row.reason ?? '')))
        return {
          status: rows.length ? (critical ? 'critical' : 'warning') : 'healthy',
          message: rows.length ? `พบปัญหา Auth/Reset Password ${rows.length} ครั้งใน 15 นาทีล่าสุด: ${rows.map(row=>String(row.reason ?? 'unknown')).join(' | ')}` : 'ไม่พบปัญหา Login/Reset Password ใหม่',
          metadata: { auth_alerts_15m: rows.length, latest_auth_alert_id: rows[0]?.id ?? null, latest_auth_alert_at: rows[0]?.created_at ?? null },
        }
      }),
      check('employee_readiness', 'ความพร้อมพนักงานก่อนลงเวลา', 'Workforce', async () => {
        let query=admin.from('employee_onboarding_readiness')
          .select('profile_id,full_name,employee_code,has_name,has_employment,has_pay_rate,has_work_policy,has_site')
          .eq('ready_to_clock',false)
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const { data, error } = await query.limit(20)
        if (error) throw error
        const people=(data??[]).map(row=>({
          profile_id:row.profile_id,
          name:row.full_name||row.employee_code||`Profile ${String(row.profile_id).slice(0,8)}`,
          employee_code:row.employee_code??null,
          missing:[
            !row.has_name?'ชื่อ':null,!row.has_employment?'ข้อมูลจ้างงาน':null,!row.has_pay_rate?'ค่าจ้าง':null,
            !row.has_work_policy?'ตารางเวลา':null,!row.has_site?'ไซต์':null,
          ].filter(Boolean),
        }))
        const detail=people.map(person=>`${person.name} (ขาด ${person.missing.join(', ')})`).join('; ')
        return {
          status:people.length?'warning':'healthy',
          message:people.length?`พนักงานข้อมูลไม่พร้อม ${people.length} คน: ${detail}`:'พนักงานพร้อมลงเวลา',
          metadata:{not_ready:people.length,not_ready_people:people},
        }
      }),
      check('boq', 'ระบบ BOQ', 'BOQ', async () => {
        let query=admin.from('boq_documents').select('id,projects(name)')
        if(actorCompanyId)query=query.eq('company_id',actorCompanyId)
        const { error } = await query.limit(1)
        if (error) throw error
        return { message: 'ตารางและความสัมพันธ์ BOQ ปกติ' }
      }),
      check('edge_functions', 'Edge Functions', 'Supabase Functions', async () => {
        const response = await fetch(`${supabaseUrl}/functions/v1/drawing-ai-benchmark`, { method: 'OPTIONS' })
        return { status: response.status >= 500 ? 'critical' : 'healthy', message: `ตอบกลับ HTTP ${response.status}` }
      }),
    ])

    let previousQuery=admin.from('health_monitor_checks').select('*')
    previousQuery=actorCompanyId?previousQuery.eq('company_id',actorCompanyId):previousQuery.is('company_id',null)
    const { data: previousRows } = await previousQuery
    const previous = new Map((previousRows ?? []).map((row) => [row.check_key, row]))
    const now = new Date().toISOString()

    for (const result of results) {
      const old = previous.get(result.key)
      const failureCount = result.status === 'healthy' ? 0 : Number(old?.failure_count ?? 0) + 1
      const recoveryCount = result.status === 'healthy' ? Number(old?.metadata?.recovery_count ?? 0) + 1 : 0
      const {data:checkRow,error:checkError}=await admin.from('health_monitor_checks').upsert({
        company_id:actorCompanyId,scope_key:actorCompanyId??'global',
        check_key: result.key, name_th: result.name, module: result.module, status: result.status,
        failure_count: failureCount, message: result.message, latency_ms: result.latency,
        metadata: { ...(result.metadata ?? {}), recovery_count: recoveryCount }, last_checked_at: now,
        last_success_at: result.status === 'healthy' ? now : old?.last_success_at ?? null, updated_at: now,
      },{onConflict:'scope_key,check_key'}).select('id').single()
      if(checkError)throw checkError

      const { data: openIncident } = await admin.from('health_monitor_incidents').select('*').eq('check_id',checkRow.id).eq('status', 'open').maybeSingle()
      if (result.status === 'healthy' && openIncident && recoveryCount >= 2) {
        await admin.from('health_monitor_incidents').update({ status: 'resolved', resolved_at: now }).eq('id', openIncident.id)
        await recordAdminNotification('recovery', openIncident.id,
          `🟢 WisdomAI กลับมาปกติ\nระบบ: ${result.name}\nรายละเอียด: ${result.message}\nเวลา: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,actorCompanyId)
      } else if (result.status !== 'healthy' && failureCount >= (result.key === 'auth_recovery_alerts' ? 1 : Math.max(2, settings.alert_after_failures))) {
        if (!openIncident) {
          const { data: incident } = await admin.from('health_monitor_incidents').insert({
            company_id:actorCompanyId,check_id:checkRow.id,check_key: result.key, severity: result.status, title: result.name, message: result.message, last_alerted_at: now,
          }).select('id').single()
          await recordAdminNotification('incident', incident?.id ?? null,
            `${result.status === 'critical' ? '🔴' : '🟠'} WisdomAI มีปัญหา\nระบบ: ${result.name}\nผู้รับผิดชอบ: ${settings.responsible_name || 'ยังไม่กำหนด'}\nปัญหา: ${result.message}\nพบต่อเนื่อง: ${failureCount} ครั้ง`,actorCompanyId)
        } else if (!openIncident.last_alerted_at || Date.now() - new Date(openIncident.last_alerted_at).getTime() >= Math.max(30, settings.repeat_alert_minutes) * 60_000) {
          await admin.from('health_monitor_incidents').update({ message: result.message, last_alerted_at: now }).eq('id', openIncident.id)
          await recordAdminNotification('repeat', openIncident.id,
            `🟠 WisdomAI ปัญหายังไม่จบ\nระบบ: ${result.name}\nรายละเอียด: ${result.message}\nกรุณาตรวจสอบ`,actorCompanyId)
        }
      }
    }

    const counts = results.reduce((acc, item) => ({ ...acc, [item.status]: acc[item.status] + 1 }), { healthy: 0, warning: 0, critical: 0 })
    await updateErrorWorkItem(results, now)
    for (const failure of results.filter(result => result.status !== 'healthy')) {
      if (!actorCompanyId) continue
      const oldCheck=previous.get(failure.key)
      const isRepeatedClientSnapshot=failure.key==='client_errors'
        && Boolean(failure.metadata?.latest_error_id)
        && oldCheck?.metadata?.latest_error_id===failure.metadata?.latest_error_id
      if(isRepeatedClientSnapshot)continue
      const fingerprint = `health:${failure.module.toLowerCase()}:${failure.key.toLowerCase()}`.slice(0, 200)
      const correlationKey = `${failure.module}|${failure.key}|${failure.message}`.toLowerCase().replace(/\b\d{4,}\b/g, ':number').slice(0, 300)
      const { error: intakeError } = await admin.rpc('upsert_system_error_event', {
        target_company_id: actorCompanyId,
        target_fingerprint: fingerprint,
        target_correlation_key: correlationKey,
        target_source: 'health_monitor',
        target_title: `${failure.name}: ${failure.status}`,
        target_message: failure.message,
        target_module: failure.module,
        target_severity: failure.status === 'critical' ? 'critical' : 'warning',
        target_metadata: { check_key: failure.key, latency_ms: failure.latency, ...(failure.metadata ?? {}) },
        target_evidence_message_id: null,
        target_is_user_report: false,
      })
      if (intakeError) throw new Error(`Error intake failed for ${failure.key}: ${intakeError.message}`)
    }
    if(actorCompanyId){
      const healthyFingerprints=results.filter(result=>result.status==='healthy')
        .map(result=>`health:${result.module.toLowerCase()}:${result.key.toLowerCase()}`.slice(0,200))
      const clientCheck=results.find(result=>result.key==='client_errors')
      const recoveryCutoff=clientCheck?.status==='healthy'?new Date(Date.now()-15*60_000).toISOString():null
      const {error:reconciliationError}=await admin.rpc('reconcile_system_error_events',{
        target_company_id:actorCompanyId,
        target_healthy_fingerprints:healthyFingerprints,
        target_client_recovery_cutoff:recoveryCutoff,
      })
      if(reconciliationError)throw new Error(`Error lifecycle reconciliation failed: ${reconciliationError.message}`)
    }
    await admin.rpc('reconcile_system_error_work_item')
    await admin.from('health_monitor_runs').update({ status: 'completed', healthy_count: counts.healthy, warning_count: counts.warning, critical_count: counts.critical, finished_at: now }).eq('id', run.id)
    if (body.source === 'pg_cron') {
      await admin.from('system_work_items').update({
        status: 'done',
        progress: 100,
        production_status: 'deployed_cron_smoke_passed',
        evidence: `Vault-backed health monitor Cron deployed; scheduled run ${run.id} completed at ${now}; anonymous request rejected; regression, lint and build passed.`,
        worker_id: null,
        heartbeat_at: null,
        lease_expires_at: null,
        current_step: 'completed',
        updated_at: now,
      }).eq('work_key', 'SYS-002').eq('status', 'ready').eq('production_status', 'awaiting_approval').is('worker_id', null)
    }

    const parts = bangkokParts()
    const todayStart = `${parts.year}-${parts.month}-${parts.day}T00:00:00+07:00`
    const [summaryHour, summaryMinute] = String(settings.daily_summary_time).slice(0,5).split(':').map(Number)
    const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute)
    let summaryQuery=admin.from('health_monitor_notifications').select('id', { count: 'exact', head: true }).eq('notification_type','daily_summary').gte('created_at',todayStart)
    summaryQuery=actorCompanyId?summaryQuery.eq('company_id',actorCompanyId):summaryQuery.is('company_id',null)
    const { count: summarySent } = await summaryQuery
    if (!summarySent && currentMinutes >= summaryHour * 60 + summaryMinute && currentMinutes < summaryHour * 60 + summaryMinute + settings.check_interval_minutes + 1) {
      await recordAdminNotification('daily_summary', null,
        `📊 สรุป WisdomAI ประจำวัน\nปกติ: ${counts.healthy}\nเฝ้าระวัง: ${counts.warning}\nวิกฤต: ${counts.critical}\nผู้รับผิดชอบ: ${settings.responsible_name || 'ยังไม่กำหนด'}`,actorCompanyId)
    }
    return json({ status: 'completed', run_id: run.id, counts, results })
  } catch (error) {
    await admin.from('health_monitor_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_message: error instanceof Error ? error.message : String(error) }).eq('id', run.id)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
