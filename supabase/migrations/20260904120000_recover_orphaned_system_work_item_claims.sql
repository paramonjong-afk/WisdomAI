-- Root-cause fix: SYS-PERF-001 was found stuck with status='blocked' and a
-- non-null worker_id/lease_expires_at/heartbeat_at because whatever process
-- marked it blocked (a local runner script) updated system_work_items
-- directly instead of going through finish_system_work_item, which always
-- clears the claim fields. The previous recover_stale_system_work_items only
-- matched status = 'doing', so a blocked row with an orphaned claim was
-- invisible to it and sat stale indefinitely (observed: 16+ days, worker_id
-- 'local-windows-runner-01', lease_expires_at 2026-08-19).
--
-- This migration:
--   1. Broadens recover_stale_system_work_items to release an orphaned claim
--      on ANY status, not only 'doing' -- without forcing a genuinely
--      blocked item back into the ready queue (that stays a human decision).
--   2. Schedules the recovery function on a 15-minute pg_cron timer so it
--      runs even when no worker is actively claiming new work (previously it
--      only ran as a side effect inside claim_system_work_item, so if the
--      worker itself stopped running, nothing ever called recovery again).
--   3. Applies it once immediately so any claim already stuck is released as
--      soon as this migration runs.

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

  -- Unchanged behavior: a stale/orphan 'doing' item goes back to 'ready' so
  -- the next worker can retry it.
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

  -- New: release an orphaned claim on any other status (e.g. a row a runner
  -- marked 'blocked' directly, without going through
  -- finish_system_work_item). Only the claim fields are cleared here; status
  -- is left untouched so a genuinely blocked item is not silently retried in
  -- a loop against the same blocker -- a human still decides what happens to
  -- a blocked item, but other agents can now see the claim is not alive.
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

  update public.system_work_items as item
  set status = 'ready', worker_id = null, heartbeat_at = null, lease_expires_at = null, current_step = null,
      production_status = case when item.production_status = 'local_runner_failed' then 'retry_after_runner_fix' else item.production_status end,
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: retry after replacing unsupported Codex CLI option.'), 4000),
      updated_at = now()
  where item.status = 'blocked' and item.evidence ilike '%--ask-for-approval%';
  get diagnostics retry_items = row_count;

  return expired_runs + recovered_items + released_claims + retry_items;
end;
$function$;

comment on function public.recover_stale_system_work_items(integer) is
  'Releases stale/orphaned system_work_items claims (worker_id/lease/heartbeat) for ANY status, and requeues stale doing items to ready. Scheduled every 15 minutes via pg_cron so recovery does not depend on a worker actively claiming new work.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'wisdomai-recover-stale-work-items') then
    perform cron.unschedule('wisdomai-recover-stale-work-items');
  end if;

  perform cron.schedule(
    'wisdomai-recover-stale-work-items',
    '*/15 * * * *',
    'select public.recover_stale_system_work_items(10);'
  );
end
$$;

-- Apply immediately so any claim already stuck (e.g. SYS-PERF-001) is
-- released as soon as this migration runs, instead of waiting for the first
-- scheduled tick.
select public.recover_stale_system_work_items(10);
