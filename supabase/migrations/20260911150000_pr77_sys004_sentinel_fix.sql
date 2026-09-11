-- SYS-004 is an incident-monitoring sentinel, not a worker-owned queue item.
-- It stays `doing` without a worker lease while health-monitor refreshes its
-- grouped error state.  Do not let stale recovery requeue it or generic
-- automation repeatedly claim it.

create or replace function public.recover_stale_system_work_items(stale_after_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
    -- Monitoring sentinels intentionally have no worker lease. Their owner is
    -- health-monitor, which refreshes status/evidence independently.
      and item.work_key <> 'SYS-004'
    and coalesce(item.production_status, '') not like 'monitoring_active%'
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
  -- The sentinel itself is excluded from the block above, so if it already
  -- carries a stale claim from before this migration, clear the lease
  -- fields without touching status -- health-monitor, not the claim loop,
  -- owns SYS-004's status.
  update public.system_work_items as item
  set worker_id = null, heartbeat_at = null, lease_expires_at = null, current_step = null,
      updated_at = now()
  where item.work_key = 'SYS-004'
    and (
      item.worker_id is not null
      or item.heartbeat_at is not null
      or item.lease_expires_at is not null
    );

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
$$;

create or replace function public.claim_system_work_item(
  target_worker text,
  lease_minutes integer default 15,
  max_attempts integer default 5
)
returns table(
  work_key text,title text,category text,risk text,detail text,progress smallint,
  company_id uuid,run_id uuid,approval_status text,approval_fingerprint text
)
language plpgsql
security definer
set search_path = public
as $$
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
    -- A monitoring sentinel is never a generic worker task, even if a legacy
    -- row was incorrectly requeued before this migration.
        and item.work_key <> 'SYS-004'
    and coalesce(item.production_status, '') not like 'monitoring_active%'
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
  set status = 'doing', worker_id = trim(target_worker), heartbeat_at = now(),
      lease_expires_at = now() + make_interval(mins => lease_minutes), current_step = 'claimed',
      attempt_count = item.attempt_count + 1, blocked_since = null, updated_at = now(),
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed by automation worker; run_id=' || selected_run::text), 4000)
  where item.work_key = selected.work_key;

  return query select selected.work_key, selected.title, selected.category, selected.risk, selected.detail,
    selected.progress, selected.company_id, selected_run, selected.approval_status, selected.approval_fingerprint;
end;
$$;

revoke all on function public.claim_system_work_item(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_system_work_item(text, integer, integer) to service_role;
