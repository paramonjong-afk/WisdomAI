begin;

-- Approval-gated work must not be leased until an administrator has made an
-- explicit decision. This prevents high-risk work from starving safe work.
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

  select item.* into selected
  from public.system_work_items as item
  where item.status = 'ready'
    and coalesce(item.production_status, '') <> 'awaiting_approval'
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
      attempt_count = item.attempt_count + 1, updated_at = now(),
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed by automation worker; run_id=' || selected_run::text), 4000)
  where item.work_key = selected.work_key;

  return query
  select selected.work_key, selected.title, selected.category, selected.risk,
         selected.detail, selected.progress, selected.company_id, selected_run;
end;
$$;

revoke all on function public.claim_system_work_item(text, integer) from public, anon, authenticated;
grant execute on function public.claim_system_work_item(text, integer) to service_role;

update public.system_work_items
set detail = 'Automatic error aggregation; fixed approval-loop starvation in the worker queue.',
    evidence = left(concat_ws(E'\n', nullif(evidence, ''), '10/8/2569: approved fix excludes awaiting_approval rows from atomic claim until an administrator explicitly approves them.'), 4000),
    updated_at = now()
where work_key = 'SYS-004';

commit;
