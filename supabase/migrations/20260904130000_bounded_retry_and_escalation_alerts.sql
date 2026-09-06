-- Path 2 (bounded retry escalation) + Path 3 (human notification) for the
-- multi-agent Auto system, per the "เส้นทาง 1 2 3" fallback plan discussed
-- with the user on 2026-09-04. Builds on
-- 20260904120000_recover_orphaned_system_work_item_claims.sql (เส้นทาง 1:
-- self-healing claim recovery), which this migration does not touch except
-- as noted in point 6 below.
--
-- Problem being solved: attempt_count on system_work_items already existed
-- and was already incremented on every claim (see claim_system_work_item),
-- but nothing ever read it -- an item could be reclaimed and fail forever
-- with no limit and no one ever told. Separately, a 'blocked' item had no
-- recorded "since when" timestamp, so there was no way to detect "stuck
-- for N hours" versus "just blocked a minute ago".
--
-- This migration adds:
--   1. system_work_items.blocked_since -- set the first time an item enters
--      'blocked' in a given blocked spell, cleared the moment it is claimed
--      again or finishes in any other status.
--   2. claim_system_work_item now refuses to auto-claim an item once its
--      attempt_count reaches max_attempts (default 5, tunable per call).
--      This is the actual retry-loop circuit breaker -- since AGENTS.md
--      requires every worker/agent to claim through this function, the cap
--      applies uniformly regardless of which AI or script is running.
--   3. finish_system_work_item now also writes error_fingerprint onto
--      system_work_items itself (previously only system_worker_runs got
--      it), and stamps/clears blocked_since.
--   4. reset_system_work_item_retry(work_key, actor) -- the explicit,
--      audited escape hatch a human (or an agent acting on human
--      instruction) calls after fixing the real root cause, to clear
--      attempt_count/blocked_since and requeue the item to 'ready'. Retry
--      budget is never silently reset by automation.
--   5. A new health-monitor action 'send_work_escalations' (added in the
--      companion Edge Function change, supabase/functions/health-monitor/
--      index.ts) is invoked every 30 minutes via pg_cron + the existing
--      Vault secret, and pings the admin Telegram room(s) for any 'blocked'
--      item that has hit the retry cap OR has been blocked longer than 2
--      hours -- rate-limited to once per item per hour so it does not spam.
--   6. Bug fix: recover_stale_system_work_items' one-time
--      "--ask-for-approval retry" clause matched on evidence text alone,
--      which persists forever once written -- so if that item became
--      blocked again later for an unrelated reason, the clause would have
--      silently forced it back to 'ready' in a loop, undermining the very
--      retry cap this migration adds. Narrowed to also require
--      production_status = 'local_runner_failed', matching the original
--      intent.
--
-- Thresholds (max_attempts=5, blocked-hours=2, notify-rate-limit=60min) are
-- defaults chosen to be generous enough to tolerate transient infra hiccups
-- while still guaranteeing a human eventually finds out. They are easy to
-- change later without another migration: max_attempts is a parameter on
-- claim_system_work_item, and the other two live in the Edge Function.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.system_work_items
  add column if not exists blocked_since timestamptz;

comment on column public.system_work_items.blocked_since is
  'Set the first time this item enters status=blocked in the current blocked spell; cleared on claim or on finishing in any other status. Used by the escalation notifier to detect items stuck a long time even when attempt_count has not yet hit the retry cap.';

update public.system_work_items
set blocked_since = coalesce(blocked_since, updated_at)
where status = 'blocked' and blocked_since is null;

-- 2: claim_system_work_item gains the retry cap and clears blocked_since on
-- claim. Signature gains a new, defaulted max_attempts parameter, so
-- existing callers that only pass target_worker/lease_minutes are
-- unaffected.
-- PostgreSQL identifies functions by name and input types. Drop the old
-- two-argument signature first so default arguments do not leave ambiguous
-- two-argument RPC calls behind.
drop function if exists public.claim_system_work_item(text, integer);

create function public.claim_system_work_item(target_worker text, lease_minutes integer default 15, max_attempts integer default 5)
returns table(work_key text, title text, category text, risk text, detail text, progress smallint, company_id uuid, run_id uuid, approval_status text, approval_fingerprint text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  selected public.system_work_items;
  selected_run uuid;
begin
  if nullif(trim(target_worker), '') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;
  if max_attempts < 2 or max_attempts > 20 then raise exception 'invalid_max_attempts'; end if;

  perform public.recover_stale_system_work_items(10);

  select item.* into selected
  from public.system_work_items as item
  where item.status = 'ready'
    and coalesce(item.production_status, '') <> 'awaiting_approval'
    and item.attempt_count < max_attempts
    and (
      not (
        item.category = 'tenant'
        or item.risk = 'critical'
        or concat_ws(' ', item.title, item.detail, item.category) ~*
           '(migration|secret|credential|permission|security|RLS|delete|drop|production schema)'
      )
      or (
        item.approval_status = 'approved'
        and item.approval_fingerprint = public.system_work_item_scope_fingerprint(
          item.work_key, item.title, item.category, item.risk, item.detail
        )
      )
    )
  order by
    case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    item.updated_at,
    item.work_key
  for update skip locked limit 1;

  if not found then return; end if;

  update public.system_worker_runs as prior_run
  set status = 'expired', finished_at = now(),
      evidence = left(concat_ws(E'\n', nullif(prior_run.evidence, ''), 'Superseded by a new worker lease.'), 4000)
  where prior_run.work_key = selected.work_key and prior_run.status = 'running';

  insert into public.system_worker_runs(work_key,company_id,worker_id,status,current_step,progress)
  values(selected.work_key,selected.company_id,trim(target_worker),'running','claimed',selected.progress)
  returning id into selected_run;

  update public.system_work_items as item
  set status = 'doing',
      worker_id = trim(target_worker),
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(mins => lease_minutes),
      current_step = 'claimed',
      attempt_count = item.attempt_count + 1,
      blocked_since = null,
      updated_at = now(),
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed by automation worker; run_id=' || selected_run::text), 4000)
  where item.work_key = selected.work_key;

  return query
  select selected.work_key, selected.title, selected.category, selected.risk, selected.detail,
         selected.progress, selected.company_id, selected_run, selected.approval_status, selected.approval_fingerprint;
end;
$function$;

revoke all on function public.claim_system_work_item(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_system_work_item(text, integer, integer) to service_role;

comment on function public.claim_system_work_item(text, integer, integer) is
  'Atomically claims the next eligible ready work item. Refuses items whose attempt_count has reached max_attempts (default 5) -- once capped, only reset_system_work_item_retry can make an item claimable again, so a repeatedly-failing task cannot retry forever unnoticed.';

-- 3: finish_system_work_item propagates error_fingerprint onto
-- system_work_items and stamps/clears blocked_since. Signature is
-- unchanged from the previously deployed version.
create or replace function public.finish_system_work_item(target_run uuid, target_worker text, target_status text, target_progress smallint, target_evidence text, target_production_status text default null::text, target_error_fingerprint text default null::text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_key text;
  run_status text;
begin
  if target_status not in ('ready','review','done','blocked') then raise exception 'invalid_finish_status'; end if;
  if target_progress < 0 or target_progress > 100 then raise exception 'invalid_progress'; end if;
  run_status := case when target_status='done' then 'completed' when target_status='blocked' then 'failed' else 'completed' end;

  update public.system_worker_runs
  set status=run_status, progress=target_progress, heartbeat_at=now(), finished_at=now(),
      evidence=left(target_evidence,4000), error_fingerprint=left(target_error_fingerprint,200)
  where id=target_run and worker_id=target_worker and status='running'
  returning work_key into target_key;

  if target_key is null then return false; end if;

  update public.system_work_items as item
  set status = target_status,
      progress = target_progress,
      evidence = left(target_evidence,4000),
      production_status = coalesce(nullif(target_production_status,''), item.production_status),
      error_fingerprint = coalesce(nullif(target_error_fingerprint,''), item.error_fingerprint),
      worker_id = null,
      heartbeat_at = null,
      lease_expires_at = null,
      current_step = null,
      blocked_since = case when target_status = 'blocked' then coalesce(item.blocked_since, now()) else null end,
      updated_at = now()
  where item.work_key = target_key and item.worker_id = target_worker and item.status = 'doing';

  return found;
end;
$function$;

comment on function public.finish_system_work_item(uuid, text, text, smallint, text, text, text) is
  'Ends the active run for a claimed work item. Also copies error_fingerprint onto system_work_items (previously only recorded on system_worker_runs) and stamps blocked_since the moment status becomes blocked, clearing it otherwise.';

-- 4: explicit, audited retry-budget reset. Never called by automation.
create or replace function public.reset_system_work_item_retry(target_work_key text, actor text default 'admin')
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor_label text := left(coalesce(nullif(trim(actor), ''), 'admin'), 120);
begin
  update public.system_work_items as item
  set attempt_count = 0,
      blocked_since = null,
      status = 'ready',
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''),
        'Retry budget reset by ' || actor_label || ' at ' || now()::text ||
        '; root cause presumed fixed, item requeued for retry.'), 4000),
      updated_at = now()
  where item.work_key = target_work_key
    and item.status = 'blocked';
  return found;
end;
$function$;

comment on function public.reset_system_work_item_retry(text, text) is
  'Human/administrator escape hatch: clears attempt_count and blocked_since and requeues a blocked item to ready. Never called automatically -- this is the deliberate decision point after a human confirms the root cause is fixed.';

revoke all on function public.reset_system_work_item_retry(text, text) from public, anon, authenticated;
grant execute on function public.reset_system_work_item_retry(text, text) to service_role;

-- 6: tighten recover_stale_system_work_items' one-time ask-for-approval
-- retry clause and clear blocked_since when it requeues an item. All other
-- behavior is unchanged from 20260904120000.
create or replace function public.recover_stale_system_work_items(stale_after_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  stale_cutoff timestamptz;
  expired_runs integer := 0;
  recovered_items integer := 0;
  released_claims integer := 0;
  retry_items integer := 0;
begin
  if stale_after_minutes < 2 or stale_after_minutes > 120 then
    raise exception 'invalid_stale_after_minutes';
  end if;
  stale_cutoff := now() - make_interval(mins => stale_after_minutes);

  update public.system_worker_runs as run
  set status = 'expired', finished_at = now(),
      evidence = left(concat_ws(E'\n', nullif(run.evidence, ''), 'Auto-recovery: worker heartbeat expired.'), 4000)
  where run.status = 'running' and run.heartbeat_at < stale_cutoff;
  get diagnostics expired_runs = row_count;

  update public.system_work_items as item
  set status = 'ready', worker_id = null, heartbeat_at = null, lease_expires_at = null, current_step = null,
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: stale or orphan doing item returned to queue.'), 4000),
      updated_at = now()
  where item.status = 'doing'
    and (
      item.worker_id is null
      or item.heartbeat_at is null
      or item.heartbeat_at < stale_cutoff
      or (item.lease_expires_at is not null and item.lease_expires_at < now())
    )
    and not exists (
      select 1 from public.system_worker_runs as active_run
      where active_run.work_key = item.work_key and active_run.status = 'running' and active_run.heartbeat_at >= stale_cutoff
    );
  get diagnostics recovered_items = row_count;

  update public.system_work_items as item
  set worker_id = null, heartbeat_at = null, lease_expires_at = null,
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: released orphaned claim on a non-doing item (lease/heartbeat expired); status left unchanged.'), 4000),
      updated_at = now()
  where item.status <> 'doing'
    and item.worker_id is not null
    and (
      item.heartbeat_at is null
      or item.heartbeat_at < stale_cutoff
      or (item.lease_expires_at is not null and item.lease_expires_at < now())
    );
  get diagnostics released_claims = row_count;

  -- Narrowed vs. the previous version: also require production_status =
  -- 'local_runner_failed' so this one-time historical fix cannot re-fire on
  -- an item that became blocked again later for an unrelated reason just
  -- because its evidence log still contains the old text.
  update public.system_work_items as item
  set status = 'ready', worker_id = null, heartbeat_at = null, lease_expires_at = null, current_step = null,
      blocked_since = null,
      production_status = case when item.production_status = 'local_runner_failed' then 'retry_after_runner_fix' else item.production_status end,
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: retry after replacing unsupported Codex CLI option.'), 4000),
      updated_at = now()
  where item.status = 'blocked'
    and item.production_status = 'local_runner_failed'
    and item.evidence ilike '%--ask-for-approval%';
  get diagnostics retry_items = row_count;

  return expired_runs + recovered_items + released_claims + retry_items;
end;
$function$;

comment on function public.recover_stale_system_work_items(integer) is
  'Releases stale/orphaned system_work_items claims (worker_id/lease/heartbeat) for ANY status, requeues stale doing items to ready, and (narrowly, one-time) retries items still flagged local_runner_failed with the old --ask-for-approval evidence. Scheduled every 15 minutes via pg_cron.';

-- 5: escalation notifier cron wiring. Reuses the health_monitor_secret
-- Vault entry and net.http_post pattern from
-- 202608100011_secure_health_monitor_cron.sql -- no new secret needed.
create or replace function public.invoke_health_monitor_escalations()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  monitor_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into monitor_secret
  from vault.decrypted_secrets
  where name = 'health_monitor_secret'
  order by updated_at desc
  limit 1;

  if monitor_secret is null or length(monitor_secret) < 32 then
    raise exception 'health_monitor_secret is missing or invalid';
  end if;

  select net.http_post(
    url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/health-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monitor-secret', monitor_secret
    ),
    body := '{"action":"send_work_escalations"}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_health_monitor_escalations() from public, anon, authenticated;
grant execute on function public.invoke_health_monitor_escalations() to postgres, service_role;

comment on function public.invoke_health_monitor_escalations() is
  'Invokes health-monitor action=send_work_escalations every 30 minutes using the existing Vault-backed health_monitor_secret, to alert admins about capped-retry or long-blocked system_work_items.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wisdomai-work-escalation-alerts') then
    perform cron.unschedule('wisdomai-work-escalation-alerts');
  end if;

  perform cron.schedule(
    'wisdomai-work-escalation-alerts',
    '*/30 * * * *',
    'select public.invoke_health_monitor_escalations();'
  );
end
$$;
