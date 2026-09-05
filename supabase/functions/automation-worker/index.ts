import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const expectedSecret = Deno.env.get('AUTOMATION_WORKER_SECRET')
const headers = { 'content-type': 'application/json; charset=utf-8' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

type Body = {
  action?: 'status'|'claim'|'heartbeat'|'finish'|'retry_runner_failure'|'inspect_line_voice_uat'|'complete_line_voice_uat'|'approve_review'|'start_specific'|'reset_retry'
  worker_id?: string
  work_key?: string
  run_id?: string
  step?: string
  progress?: number
  status?: 'ready'|'review'|'done'|'blocked'
  evidence?: string
  production_status?: string
  error_fingerprint?: string
  lease_minutes?: number
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!expectedSecret) return json({ error: 'worker_not_configured' }, 503)
  const supplied = request.headers.get('x-automation-worker-secret')
  if (!supplied || supplied !== expectedSecret) return json({ error: 'unauthorized' }, 401)
  const body = await request.json().catch(() => ({})) as Body
  const workerId = String(body.worker_id || '').trim().slice(0, 120)
  if (!workerId) return json({ error: 'worker_id_required' }, 400)

  if (body.action === 'status') {
    const [{ data: items, error: itemError }, { data: runs, error: runError }] = await Promise.all([
      admin.from('system_work_items').select('work_key,title,status,progress,risk,production_status,approval_status,approval_scope,approved_at,approval_channel,worker_id,heartbeat_at,lease_expires_at,current_step,updated_at').order('work_key'),
      admin.from('system_worker_runs').select('id,work_key,worker_id,status,current_step,progress,started_at,heartbeat_at,finished_at').eq('status','running').order('started_at'),
    ])
    if (itemError || runError) return json({ error: (itemError ?? runError)?.message }, 500)
    const counts = (items ?? []).reduce<Record<string,number>>((sum, item) => {
      sum[item.status] = (sum[item.status] ?? 0) + 1
      return sum
    }, {})
    return json({ counts, items, active_runs: runs ?? [], checked_at: new Date().toISOString() })
  }

  if (body.action === 'inspect_line_voice_uat') {
    const { data, error } = await admin.from('line_ingestion_events')
      .select('webhook_event_id,message_type,processing_status,processing_stage,attachment_status,analysis_status,error_message,received_at,processed_at')
      .eq('message_type', 'audio').order('received_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ event: data ?? null, checked_at: new Date().toISOString() })
  }

  if (body.action === 'complete_line_voice_uat') {
    const { data: event, error: eventError } = await admin.from('line_ingestion_events')
      .select('webhook_event_id,message_type,processing_status,processing_stage,attachment_status,analysis_status,error_message,received_at,processed_at')
      .eq('message_type', 'audio').order('received_at', { ascending: false }).limit(1).maybeSingle()
    if (eventError) return json({ error: eventError.message }, 500)
    const passed = event?.processing_status === 'processed'
      && event?.analysis_status === 'completed'
      && event?.attachment_status === 'saved'
      && ['voice_confirmation_requested', 'completed'].includes(String(event?.processing_stage || ''))
    if (!passed) return json({ updated: false, reason: 'latest_line_voice_uat_not_passed', event: event ?? null }, 409)
    const evidence = `Real LINE voice UAT passed at ${event.processed_at || event.received_at}; ingestion processed, transcription completed, confirmation requested; webhook suffix ${String(event.webhook_event_id).slice(-8)}.`
    const { data, error } = await admin.from('system_work_items').update({
      status: 'done', progress: 100, evidence, production_status: 'deployed_uat_passed',
      worker_id: null, heartbeat_at: null, lease_expires_at: null, current_step: 'completed', updated_at: new Date().toISOString(),
    }).eq('work_key', 'SYS-008').eq('status', 'review').select('work_key').maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ updated: Boolean(data), work_key: data?.work_key ?? null, event })
  }

  if (body.action === 'claim') {
    const { data, error } = await admin.rpc('claim_system_work_item', {
      target_worker: workerId, lease_minutes: Math.min(120, Math.max(5, Number(body.lease_minutes) || 15)),
    })
    if (error) return json({ error: error.message }, 500)
    return json({ item: data?.[0] ?? null })
  }

  if (body.action === 'retry_runner_failure') {
    const workKey = String(body.work_key || '').trim().slice(0, 80)
    if (!workKey) return json({ error: 'work_key_required' }, 400)
    const { data, error } = await admin.from('system_work_items').update({
      status: 'ready',
      worker_id: null,
      heartbeat_at: null,
      lease_expires_at: null,
      current_step: null,
      production_status: 'retry_after_runner_fix',
      evidence: 'Auto-recovery: valid structured result was produced but the local runner reported a non-zero process exit; retrying with corrected result handling.',
      updated_at: new Date().toISOString(),
    }).eq('work_key', workKey).eq('status', 'blocked').eq('production_status', 'local_runner_failed').select('work_key').maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ updated: Boolean(data), work_key: data?.work_key ?? null })
  }

  if (body.action === 'reset_retry') {
    // เส้นทาง 2 escape hatch: after a human confirms the real root cause of
    // a capped-retry / long-blocked item is fixed, this clears
    // attempt_count and blocked_since and requeues it to 'ready'. Never
    // called automatically by any Auto process -- see
    // reset_system_work_item_retry in
    // 20260904130000_bounded_retry_and_escalation_alerts.sql.
    const workKey = String(body.work_key || '').trim().slice(0, 80)
    if (!workKey) return json({ error: 'work_key_required' }, 400)
    const { data, error } = await admin.rpc('reset_system_work_item_retry', {
      target_work_key: workKey, actor: workerId,
    })
    if (error) return json({ error: error.message }, 500)
    return json({ updated: data === true, work_key: workKey })
  }

  if (body.action === 'approve_review') {
    const workKey = String(body.work_key || '').trim().slice(0, 80)
    if (!workKey) return json({ error: 'work_key_required' }, 400)
    const { data, error } = await admin.from('system_work_items').update({
      status: 'ready', production_status: 'approved_for_execution',
      approval_channel: 'automation_worker_admin',
      evidence: 'Approved explicitly by the system administrator for execution.', updated_at: new Date().toISOString(),
    }).eq('work_key', workKey).eq('status', 'review').select('work_key').maybeSingle()
    if (error) return json({ error: error.message }, 500)
    return json({ updated: Boolean(data), work_key: data?.work_key ?? null })
  }

  if (body.action === 'start_specific') {
    const workKey = String(body.work_key || '').trim().slice(0, 80)
    if (!workKey) return json({ error: 'work_key_required' }, 400)
    const { data, error } = await admin.rpc('claim_specific_system_work_item', {
      target_work_key: workKey,
      target_worker: workerId,
      lease_minutes: Math.min(120, Math.max(5, Number(body.lease_minutes) || 60)),
    })
    if (error) return json({ error: error.message }, 500)
    return json({ item: data?.[0] ?? null })
  }

  if (!body.run_id) return json({ error: 'run_id_required' }, 400)
  if (body.action === 'heartbeat') {
    const { data, error } = await admin.rpc('heartbeat_system_work_item', {
      target_run: body.run_id,target_worker: workerId,target_step: String(body.step || 'working'),
      target_progress: Math.min(100,Math.max(0,Number(body.progress)||0)),
      lease_minutes: Math.min(120,Math.max(5,Number(body.lease_minutes)||15)),
    })
    if (error) return json({ error: error.message }, 500)
    return json({ updated: data === true })
  }
  if (body.action === 'finish') {
    const { data, error } = await admin.rpc('finish_system_work_item', {
      target_run: body.run_id,target_worker: workerId,target_status: body.status,
      target_progress: Math.min(100,Math.max(0,Number(body.progress)||0)),
      target_evidence: String(body.evidence || ''),target_production_status: body.production_status || null,
      target_error_fingerprint: body.error_fingerprint || null,
    })
    if (error) return json({ error: error.message }, 500)
    return json({ updated: data === true })
  }
  return json({ error: 'invalid_action' }, 400)
})
