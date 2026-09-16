import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const expectedSecret = Deno.env.get('AUTOMATION_WORKER_SECRET')
const headers = { 'content-type': 'application/json; charset=utf-8' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })

type ModelTier = 'economy'|'balanced'|'reasoning'
type QaTier = 'automated'|'standard'|'independent'|'human'
const defaultRoute = (category: string, risk: string) => {
  const high = risk === 'critical' || ['tenant','security','migration'].includes(category)
  const low = risk === 'low' && ['operations','report','audit'].includes(category)
  return {
    model_tier: (high ? 'reasoning' : low ? 'economy' : 'balanced') as ModelTier,
    model_name: null as string | null,
    token_budget_input: high ? 48000 : low ? 12000 : 24000,
    token_budget_output: high ? 12000 : low ? 3000 : 6000,
    token_soft_limit_percent: 80,
    qa_tier: (high ? 'independent' : low ? 'automated' : 'standard') as QaTier,
  }
}

async function routeWork(item: Record<string, unknown>) {
  const requestedCategory = String(item.category || 'operations')
  const requestedRisk = String(item.risk || 'medium')
  const category = ['operations','automation','line','report','audit','tenant','security','migration'].includes(requestedCategory) ? requestedCategory : 'operations'
  const risk = ['low','medium','high','critical'].includes(requestedRisk) ? requestedRisk : 'medium'
  const companyId = typeof item.company_id === 'string' ? item.company_id : null
  let query = admin.from('system_model_policies').select('model_tier,model_name,token_budget_input,token_budget_output,token_soft_limit_percent,qa_tier')
    .eq('enabled', true).or(`category.eq.${category},category.is.null`).or(`risk.eq.${risk},risk.is.null`)
  query = companyId ? query.or(`company_id.eq.${companyId},company_id.is.null`) : query.is('company_id', null)
  const { data } = await query.order('company_id', { ascending: false, nullsFirst: false }).order('category', { ascending: false, nullsFirst: false }).order('risk', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return { ...defaultRoute(category, risk), ...(data ?? {}) }
}

type WorkerOutcome = 'acknowledged'|'claimed'|'blocked'|'completed'|'no_output'
type Body = {
  action?: 'status'|'claim'|'heartbeat'|'finish'|'retry_runner_failure'|'inspect_line_voice_uat'|'complete_line_voice_uat'|'start_specific'|'reset_retry'
  worker_id?: string
  work_key?: string
  run_id?: string
  step?: string
  progress?: number
  status?: 'ready'|'review'|'done'|'blocked'
  evidence?: string
  production_status?: string
  error_fingerprint?: string
  outcome?: WorkerOutcome
  outcome_reason?: string
  current_step?: string
  control_state?: 'queued'|'blocked'|'paused'|'waiting_permission'|'token_limit'|'waiting_qa'|'worker_lost'|'done'
  checkpoint?: Record<string, unknown>
  context_manifest?: Record<string, unknown>
  problem_category?: 'code'|'token'|'allow'|'policy'|'dependency'|'config'|'data'|'network'|'qa'|'worker_lost'|'unknown'
  new_information_hash?: string
  token_input?: number
  token_output?: number
  estimated_cost_usd?: number
  actual_cost_usd?: number
  cache_hit?: boolean
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
      admin.from('system_work_items').select('work_key,title,status,progress,risk,production_status,approval_status,approval_scope,approved_at,approval_channel,worker_id,heartbeat_at,lease_expires_at,current_step,attempt_count,error_fingerprint,worker_outcome,worker_outcome_reason,worker_outcome_at,requirement_version,controller_owner,execution_owner,qa_owner,control_state,checkpoint,context_manifest,new_information_hash,model_tier,model_name,token_budget_input,token_budget_output,token_input_total,token_output_total,estimated_cost_usd,actual_cost_usd,qa_tier,escalation_level,cache_hit,prompt_version,output_schema_version,work_kind,monitor_state,monitor_checked_at,monitor_open_incident_count,monitor_evidence,monitor_fingerprint,updated_at').order('work_key'),
      admin.from('system_worker_runs').select('id,work_key,worker_id,status,current_step,progress,outcome,outcome_reason,started_at,heartbeat_at,finished_at').order('started_at', { ascending: false }).limit(100),
    ])
    if (itemError || runError) return json({ error: (itemError ?? runError)?.message }, 500)
    const counts = (items ?? []).reduce<Record<string,number>>((sum, item) => {
      sum[item.status] = (sum[item.status] ?? 0) + 1
      return sum
    }, {})
    const runHistory = runs ?? []
    const liveCutoff = Date.now() - 10 * 60_000
    const liveRuns = runHistory.filter(run => run.status === 'running' && new Date(run.heartbeat_at).getTime() >= liveCutoff)
    const actionableCounts = (items ?? []).filter(item => item.work_kind !== 'monitoring_sentinel').reduce<Record<string,number>>((sum, item) => {
      sum[item.status] = (sum[item.status] ?? 0) + 1
      return sum
    }, {})
    return json({ counts, actionable_counts: actionableCounts, items, active_runs: liveRuns, live_runs: liveRuns, run_history: runHistory, checked_at: new Date().toISOString() })
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
    const { data, error } = await admin.rpc('claim_system_work_item_v2', {
      target_worker: workerId, lease_minutes: Math.min(120, Math.max(5, Number(body.lease_minutes) || 15)),
    })
    if (error) return json({ error: error.message }, 500)
    const item = data?.[0] as Record<string, unknown> | undefined
    if (!item) return json({ item: null })
    const route = await routeWork(item)
    const runRoute = {
      model_tier: route.model_tier, model_name: route.model_name,
      token_budget_input: route.token_budget_input, token_budget_output: route.token_budget_output,
      prompt_version: 'work-control-v2', output_schema_version: '2',
    }
    const [itemRouteWrite, runRouteWrite] = await Promise.all([
      admin.from('system_work_items').update(route).eq('work_key', item.work_key),
      admin.from('system_worker_runs').update(runRoute).eq('id', item.run_id),
    ])
    const routing_warning = itemRouteWrite.error?.message || runRouteWrite.error?.message || null
    return json({ item: { ...item, ...route, prompt_version: 'work-control-v2', output_schema_version: '2' }, routing_warning })
  }

  if (body.action === 'retry_runner_failure') {
    const workKey = String(body.work_key || '').trim().slice(0, 80)
    if (!workKey) return json({ error: 'work_key_required' }, 400)
    const { data: item, error: itemError } = await admin.from('system_work_items')
      .select('requirement_version,error_fingerprint,new_information_hash').eq('work_key', workKey).maybeSingle()
    if (itemError) return json({ error: itemError.message }, 500)
    if (!item?.error_fingerprint) return json({ updated: false, reason: 'problem_fingerprint_required' }, 409)
    const { data: problem, error: problemError } = await admin.from('system_work_problems')
      .select('retry_allowed').eq('work_key', workKey).eq('requirement_version', item.requirement_version)
      .eq('problem_fingerprint', item.error_fingerprint).maybeSingle()
    if (problemError) return json({ error: problemError.message }, 500)
    if (!problem?.retry_allowed) return json({ updated: false, reason: 'no_new_information_retry_blocked' }, 409)
    const { data, error } = await admin.from('system_work_items').update({
      status: 'ready',
      worker_id: null,
      heartbeat_at: null,
      lease_expires_at: null,
      current_step: 'controlled_retry_after_new_information',
      control_state: 'queued',
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
    const newInformationHash = String(body.new_information_hash || '').trim().slice(0, 200)
    if (!newInformationHash) return json({ error: 'new_information_required' }, 400)
    const { data, error } = await admin.rpc('reset_system_work_item_retry_v2', {
      target_work_key: workKey, target_actor: workerId, target_new_information_hash: newInformationHash,
    })
    if (error) return json({ error: error.message }, 500)
    return json({ updated: data === true, work_key: workKey })
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
    const item = data?.[0] as Record<string, unknown> | undefined
    if (!item) return json({ item: null })
    const route = await routeWork(item)
    const runRoute = {
      model_tier: route.model_tier, model_name: route.model_name,
      token_budget_input: route.token_budget_input, token_budget_output: route.token_budget_output,
      prompt_version: 'work-control-v2', output_schema_version: '2',
    }
    const [itemRouteWrite, runRouteWrite] = await Promise.all([
      admin.from('system_work_items').update(route).eq('work_key', item.work_key),
      admin.from('system_worker_runs').update(runRoute).eq('id', item.run_id),
    ])
    return json({
      item: { ...item, ...route, prompt_version: 'work-control-v2', output_schema_version: '2' },
      routing_warning: itemRouteWrite.error?.message || runRouteWrite.error?.message || null,
    })
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
    if (!body.outcome || !body.outcome_reason?.trim()) {
      return json({ error: 'terminal_outcome_and_reason_required' }, 400)
    }
    const controlState = body.control_state || (body.status === 'done' ? 'done' : body.status === 'blocked' ? 'blocked' : 'waiting_qa')
    const { data, error } = await admin.rpc('finish_system_work_item_v2', {
      target_run: body.run_id,target_worker: workerId,target_status: body.status,
      target_progress: Math.min(100,Math.max(0,Number(body.progress)||0)),
      target_evidence: String(body.evidence || ''),target_production_status: body.production_status || null,
      target_error_fingerprint: body.error_fingerprint || null,
      target_outcome: body.outcome,
      target_outcome_reason: body.outcome_reason.trim().slice(0, 1000),
      target_current_step: String(body.current_step || body.step || controlState).slice(0, 500),
      target_control_state: controlState,
      target_checkpoint: body.checkpoint || {},
      target_context_manifest: body.context_manifest || {},
      target_problem_category: body.problem_category || null,
      target_new_information_hash: body.new_information_hash || null,
      target_token_input: Number.isFinite(body.token_input) ? body.token_input : null,
      target_token_output: Number.isFinite(body.token_output) ? body.token_output : null,
    })
    if (error) return json({ error: error.message }, 500)
    const { error: costError } = await admin.rpc('record_system_work_cost_v2', {
      target_run: body.run_id,target_worker: workerId,
      target_token_input: Math.max(0,Number(body.token_input)||0),target_token_output: Math.max(0,Number(body.token_output)||0),
      target_estimated_cost: Math.max(0,Number(body.estimated_cost_usd)||0),target_actual_cost: Math.max(0,Number(body.actual_cost_usd)||0),
      target_cache_hit: body.cache_hit === true,
    })
    // The work item is already terminal at this point. A telemetry failure must
    // not make the runner retry the completed operation and duplicate effects.
    return json({ updated: data === true, cost_recorded: !costError, cost_warning: costError?.message ?? null })
  }
  return json({ error: 'invalid_action' }, 400)
})
