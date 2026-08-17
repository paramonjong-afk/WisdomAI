begin;

create or replace function public.claim_specific_system_work_item(
  target_work_key text,
  target_worker text,
  lease_minutes integer default 60
) returns table(work_key text, run_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  selected public.system_work_items;
  selected_run uuid;
begin
  if nullif(btrim(target_work_key), '') is null then raise exception 'work_key_required'; end if;
  if nullif(btrim(target_worker), '') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;

  perform public.recover_stale_system_work_items(10);

  select item.* into selected
  from public.system_work_items as item
  where item.work_key = btrim(target_work_key)
    and item.status = 'ready'
    and item.production_status = 'approved_for_execution'
    and item.approval_status = 'approved'
    and item.approval_fingerprint = public.system_work_item_scope_fingerprint(
      item.work_key, item.title, item.category, item.risk, item.detail
    )
  for update skip locked;

  if not found then return; end if;

  update public.system_worker_runs as prior_run
  set status = 'expired', finished_at = now(),
      evidence = left(concat_ws(E'\n', nullif(prior_run.evidence, ''), 'Superseded by an atomic specific-work claim.'), 4000)
  where prior_run.work_key = selected.work_key and prior_run.status = 'running';

  insert into public.system_worker_runs(work_key, company_id, worker_id, status, current_step, progress)
  values(selected.work_key, selected.company_id, btrim(target_worker), 'running', 'claimed_specific', selected.progress)
  returning id into selected_run;

  update public.system_work_items as item
  set status = 'doing', worker_id = btrim(target_worker), heartbeat_at = now(),
      lease_expires_at = now() + make_interval(mins => lease_minutes),
      current_step = 'claimed_specific', attempt_count = item.attempt_count + 1,
      updated_at = now(),
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed atomically for approved execution; run_id=' || selected_run::text), 4000)
  where item.work_key = selected.work_key;

  return query select selected.work_key, selected_run;
end;
$$;

revoke all on function public.claim_specific_system_work_item(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_specific_system_work_item(text, text, integer) to service_role;

comment on function public.claim_specific_system_work_item(text, text, integer) is
  'Atomically validates persistent approval, creates the worker run, and moves one requested work item to doing.';

commit;
