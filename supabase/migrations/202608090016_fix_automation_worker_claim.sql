-- Fix PL/pgSQL output-column ambiguity in the atomic work claim function.
create or replace function public.claim_system_work_item(target_worker text, lease_minutes integer default 15)
returns table(work_key text,title text,category text,risk text,detail text,progress smallint,company_id uuid,run_id uuid)
language plpgsql security definer set search_path=public as $$
declare selected public.system_work_items;
declare selected_run uuid;
begin
  if nullif(trim(target_worker),'') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;

  select item.* into selected
  from public.system_work_items as item
  where item.status='ready'
     or (item.status='doing' and item.lease_expires_at is not null and item.lease_expires_at < now())
  order by
    case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    item.updated_at,
    item.work_key
  for update skip locked limit 1;

  if not found then return; end if;

  update public.system_worker_runs as prior_run
    set status='expired',finished_at=now(),evidence=coalesce(prior_run.evidence,'') || E'\nLease expired; returned to queue.'
    where prior_run.work_key=selected.work_key and prior_run.status='running';

  insert into public.system_worker_runs(work_key,company_id,worker_id,status,current_step,progress)
    values(selected.work_key,selected.company_id,trim(target_worker),'running','claimed',selected.progress)
    returning id into selected_run;

  update public.system_work_items as item set
    status='doing',worker_id=trim(target_worker),heartbeat_at=now(),
    lease_expires_at=now()+make_interval(mins=>lease_minutes),current_step='claimed',
    attempt_count=item.attempt_count+1,updated_at=now(),
    evidence='Claimed by automation worker; run_id=' || selected_run::text
  where item.work_key=selected.work_key;

  return query select selected.work_key,selected.title,selected.category,selected.risk,
    selected.detail,selected.progress,selected.company_id,selected_run;
end $$;

revoke all on function public.claim_system_work_item(text,integer) from public,anon,authenticated;
grant execute on function public.claim_system_work_item(text,integer) to service_role;

update public.system_work_items
set detail='รวม Error อัตโนมัติ; ล่าสุด Automation Worker claim ล้มเหลวจาก fingerprint db.rpc.claim_system_work_item.work_key_ambiguous',
    evidence='9/8/2569: root cause confirmed from Production HTTP 500: column reference work_key is ambiguous; migration 202608090016 qualifies all conflicting columns.',
    updated_at=now()
where work_key='SYS-004';
