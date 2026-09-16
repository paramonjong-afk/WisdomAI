-- SYS-004 is a continuously-running monitoring sentinel, not executable work.
-- Keep monitor telemetry separate from Controller/Worker execution fields.

begin;

alter table public.system_work_items
  add column if not exists work_kind text not null default 'executable',
  add column if not exists monitor_state text,
  add column if not exists monitor_checked_at timestamptz,
  add column if not exists monitor_open_incident_count integer,
  add column if not exists monitor_evidence text,
  add column if not exists monitor_fingerprint text;

alter table public.system_work_items drop constraint if exists system_work_items_work_kind_check;
alter table public.system_work_items add constraint system_work_items_work_kind_check
  check (work_kind in ('executable','monitoring_sentinel'));

alter table public.system_work_items drop constraint if exists system_work_items_monitor_state_check;
alter table public.system_work_items add constraint system_work_items_monitor_state_check
  check (monitor_state is null or monitor_state in ('healthy','warning','critical'));

alter table public.system_work_items drop constraint if exists system_work_items_monitor_incident_count_check;
alter table public.system_work_items add constraint system_work_items_monitor_incident_count_check
  check (monitor_open_incident_count is null or monitor_open_incident_count >= 0);

-- A sentinel can never hold an execution lease. This protects every current
-- and future claim path even if its visible status is changed accidentally.
alter table public.system_work_items drop constraint if exists system_work_items_sentinel_no_worker_claim_check;
alter table public.system_work_items add constraint system_work_items_sentinel_no_worker_claim_check check (
  work_kind <> 'monitoring_sentinel' or (
    worker_id is null and heartbeat_at is null and lease_expires_at is null
  )
);

-- Keep monitoring sentinels out of both generic and targeted claim selection.
create or replace function public.claim_specific_system_work_item(
  target_work_key text, target_worker text, lease_minutes integer default 60
)
returns table(work_key text, run_id uuid)
language plpgsql security definer set search_path=public as $$
declare selected public.system_work_items; selected_run uuid;
begin
  if nullif(btrim(target_work_key), '') is null then raise exception 'work_key_required'; end if;
  if nullif(btrim(target_worker), '') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;
  perform public.recover_stale_system_work_items(10);
  select item.* into selected from public.system_work_items item
  where item.work_key=btrim(target_work_key) and item.status='ready' and item.work_kind='executable'
    and item.production_status='approved_for_execution' and item.approval_status='approved'
    and item.attempt_count < 5
    and item.approval_fingerprint=public.system_work_item_scope_fingerprint(item.work_key,item.title,item.category,item.risk,item.detail)
  for update skip locked;
  if not found then return; end if;
  update public.system_worker_runs prior_run set status='expired',finished_at=now(),outcome='no_output',
    outcome_reason='Superseded by a new approved execution claim.',
    evidence=left(concat_ws(E'\n',nullif(prior_run.evidence,''),'Superseded by an atomic specific-work claim.'),4000)
  where prior_run.work_key=selected.work_key and prior_run.status='running';
  insert into public.system_worker_runs(work_key,company_id,worker_id,status,current_step,progress,outcome,outcome_reason)
  values(selected.work_key,selected.company_id,btrim(target_worker),'running','claimed_specific',selected.progress,'claimed','Claimed atomically after approval validation.')
  returning id into selected_run;
  update public.system_work_items item set status='doing',worker_id=btrim(target_worker),heartbeat_at=now(),
    lease_expires_at=now()+make_interval(mins=>lease_minutes),current_step='claimed_specific',attempt_count=item.attempt_count+1,
    blocked_since=null,updated_at=now(),worker_outcome='claimed',worker_outcome_reason='Claimed atomically after approval validation.',worker_outcome_at=now(),
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'Claimed atomically for approved execution; run_id='||selected_run::text),4000)
  where item.work_key=selected.work_key;
  return query select selected.work_key,selected_run;
end $$;

create or replace function public.claim_system_work_item(
  target_worker text, lease_minutes integer default 15, max_attempts integer default 5
)
returns table(work_key text,title text,category text,risk text,detail text,progress smallint,company_id uuid,run_id uuid,approval_status text,approval_fingerprint text)
language plpgsql security definer set search_path=public as $$
declare selected public.system_work_items; selected_run uuid;
begin
  if nullif(trim(target_worker),'') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;
  if max_attempts < 2 or max_attempts > 20 then raise exception 'invalid_max_attempts'; end if;
  perform public.recover_stale_system_work_items(10);
  select item.* into selected from public.system_work_items item
  where item.status='ready' and item.work_kind='executable'
    and coalesce(item.production_status,'') <> 'awaiting_approval' and item.attempt_count<max_attempts
    and (not (item.category='tenant' or item.risk='critical' or concat_ws(' ',item.title,item.detail,item.category) ~* '(migration|secret|credential|permission|security|RLS|delete|drop|production schema)')
      or (item.approval_status='approved' and item.approval_fingerprint=public.system_work_item_scope_fingerprint(item.work_key,item.title,item.category,item.risk,item.detail)))
  order by case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,item.updated_at,item.work_key
  for update skip locked limit 1;
  if not found then return; end if;
  update public.system_worker_runs prior_run set status='expired',finished_at=now(),outcome='no_output',outcome_reason='Superseded by a new worker lease.',
    evidence=left(concat_ws(E'\n',nullif(prior_run.evidence,''),'Superseded by a new worker lease.'),4000)
  where prior_run.work_key=selected.work_key and prior_run.status='running';
  insert into public.system_worker_runs(work_key,company_id,worker_id,status,current_step,progress,outcome,outcome_reason)
  values(selected.work_key,selected.company_id,trim(target_worker),'running','claimed',selected.progress,'claimed','Claimed by automation worker.') returning id into selected_run;
  update public.system_work_items item set status='doing',worker_id=trim(target_worker),heartbeat_at=now(),lease_expires_at=now()+make_interval(mins=>lease_minutes),
    current_step='claimed',attempt_count=item.attempt_count+1,blocked_since=null,updated_at=now(),
    worker_outcome='claimed',worker_outcome_reason='Claimed by automation worker.',worker_outcome_at=now(),
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'Claimed by automation worker; run_id='||selected_run::text),4000)
  where item.work_key=selected.work_key;
  return query select selected.work_key,selected.title,selected.category,selected.risk,selected.detail,selected.progress,selected.company_id,selected_run,selected.approval_status,selected.approval_fingerprint;
end $$;

revoke all on function public.claim_specific_system_work_item(text,text,integer) from public,anon,authenticated;
revoke all on function public.claim_system_work_item(text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_specific_system_work_item(text,text,integer) to service_role;
grant execute on function public.claim_system_work_item(text,integer,integer) to service_role;

update public.system_work_items
set work_kind='monitoring_sentinel',
    control_state='active',
    controller_owner='health-monitor',
    execution_owner='health-monitor',
    attempt_count=0,
    worker_id=null,
    heartbeat_at=null,
    lease_expires_at=null,
    worker_outcome=null,
    worker_outcome_reason=null,
    worker_outcome_at=null,
    checkpoint='{}'::jsonb,
    context_manifest=coalesce(context_manifest,'{}'::jsonb) || jsonb_build_object('work_kind','monitoring_sentinel'),
    monitor_state=case
      when risk='critical' then 'critical'
      when risk in ('high','medium') then 'warning'
      else 'healthy'
    end,
    monitor_checked_at=updated_at,
    monitor_evidence=evidence,
    monitor_fingerprint=error_fingerprint,
    current_step='monitoring_sentinel_active',
    updated_at=now()
where work_key='SYS-004';

insert into public.system_work_item_events(work_key,event_type,old_status,new_status,old_progress,new_progress,note)
select work_key,'monitoring_sentinel_hardened',status,status,progress,progress,
  'Separated monitor telemetry from Worker execution fields; reset misleading current Worker outcome/attempt values while retaining run and event history.'
from public.system_work_items where work_key='SYS-004';

commit;
