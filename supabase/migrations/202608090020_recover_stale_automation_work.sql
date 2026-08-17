begin;

update public.system_work_items
set status = 'doing',
    progress = greatest(progress, 70),
    detail = 'Recover stale worker runs, orphan doing items, and retry jobs blocked by the retired Codex CLI option.',
    production_status = 'migration_pending',
    evidence = 'Migration 202608090020 authorized: stale work recovery and automatic claim-time recovery.',
    updated_at = now()
where work_key = 'SYS-006';

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
  retry_items integer := 0;
begin
  if stale_after_minutes < 2 or stale_after_minutes > 120 then
    raise exception 'invalid_stale_after_minutes';
  end if;

  stale_cutoff := now() - make_interval(mins => stale_after_minutes);

  update public.system_worker_runs as run
  set status = 'expired',
      finished_at = now(),
      evidence = left(
        concat_ws(E'\n', nullif(run.evidence, ''), 'Auto-recovery: worker heartbeat expired.'),
        4000
      )
  where run.status = 'running'
    and run.heartbeat_at < stale_cutoff;
  get diagnostics expired_runs = row_count;

  update public.system_work_items as item
  set status = 'ready',
      worker_id = null,
      heartbeat_at = null,
      lease_expires_at = null,
      current_step = null,
      evidence = left(
        concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: stale or orphan doing item returned to queue.'),
        4000
      ),
      updated_at = now()
  where item.status = 'doing'
    and (
      item.worker_id is null
      or item.heartbeat_at is null
      or item.heartbeat_at < stale_cutoff
      or (item.lease_expires_at is not null and item.lease_expires_at < now())
    )
    and not exists (
      select 1
      from public.system_worker_runs as active_run
      where active_run.work_key = item.work_key
        and active_run.status = 'running'
        and active_run.heartbeat_at >= stale_cutoff
    );
  get diagnostics recovered_items = row_count;

  update public.system_work_items as item
  set status = 'ready',
      worker_id = null,
      heartbeat_at = null,
      lease_expires_at = null,
      current_step = null,
      production_status = case
        when item.production_status = 'local_runner_failed' then 'retry_after_runner_fix'
        else item.production_status
      end,
      evidence = left(
        concat_ws(E'\n', nullif(item.evidence, ''), 'Auto-recovery: retry after replacing unsupported Codex CLI option.'),
        4000
      ),
      updated_at = now()
  where item.status = 'blocked'
    and item.evidence ilike '%--ask-for-approval%';
  get diagnostics retry_items = row_count;

  return expired_runs + recovered_items + retry_items;
end;
$$;

revoke all on function public.recover_stale_system_work_items(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_system_work_items(integer) to service_role;

create or replace function public.claim_system_work_item(target_worker text, lease_minutes integer default 15)
returns table(work_key text,title text,category text,risk text,detail text,progress smallint,company_id uuid,run_id uuid)
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

  perform public.recover_stale_system_work_items(10);

  select item.*
  into selected
  from public.system_work_items as item
  where item.status = 'ready'
  order by
    case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    item.updated_at,
    item.work_key
  for update skip locked
  limit 1;

  if not found then return; end if;

  insert into public.system_worker_runs(work_key, company_id, worker_id, status, current_step, progress)
  values(selected.work_key, selected.company_id, trim(target_worker), 'running', 'claimed', selected.progress)
  returning id into selected_run;

  update public.system_work_items as item
  set status = 'doing',
      worker_id = trim(target_worker),
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(mins => lease_minutes),
      current_step = 'claimed',
      attempt_count = item.attempt_count + 1,
      updated_at = now(),
      evidence = left(
        concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed by automation worker; run_id=' || selected_run::text),
        4000
      )
  where item.work_key = selected.work_key;

  return query
  select selected.work_key, selected.title, selected.category, selected.risk,
         selected.detail, selected.progress, selected.company_id, selected_run;
end;
$$;

revoke all on function public.claim_system_work_item(text, integer) from public, anon, authenticated;
grant execute on function public.claim_system_work_item(text, integer) to service_role;

select public.recover_stale_system_work_items(10);

update public.system_work_items
set status = 'review',
    progress = 90,
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    current_step = null,
    production_status = 'deployed_pending_uat',
    evidence = 'Migration 202608090020 deployed: stale runs expire after 10 minutes, orphan doing items return to ready, retired CLI-option failures retry, and claim performs recovery before leasing.',
    updated_at = now()
where work_key = 'SYS-006';

commit;
