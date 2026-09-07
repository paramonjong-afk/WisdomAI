-- CONTROL-PLANE-STALL-001
--
-- Make every claimed worker turn end with a durable, user-visible outcome and
-- provide a deliberately narrow, audited way to repair approval/execution
-- drift.  This migration never changes business records; it only controls the
-- platform work queue.

alter table public.system_worker_runs
  add column if not exists outcome text,
  add column if not exists outcome_reason text;

alter table public.system_work_items
  add column if not exists worker_outcome text,
  add column if not exists worker_outcome_reason text,
  add column if not exists worker_outcome_at timestamptz;

alter table public.system_worker_runs
  drop constraint if exists system_worker_runs_outcome_check;
alter table public.system_worker_runs
  add constraint system_worker_runs_outcome_check
  check (outcome is null or outcome in ('acknowledged','claimed','blocked','completed','no_output'));

alter table public.system_work_items
  drop constraint if exists system_work_items_worker_outcome_check;
alter table public.system_work_items
  add constraint system_work_items_worker_outcome_check
  check (worker_outcome is null or worker_outcome in ('acknowledged','claimed','blocked','completed','no_output'));

comment on column public.system_worker_runs.outcome is
  'Durable control-plane outcome for this dispatch: acknowledged, claimed, blocked, completed, or no_output.';
comment on column public.system_worker_runs.outcome_reason is
  'Human-readable reason retained even when the assistant produces no final message.';

-- A submitted work item must enter the existing review/approval path rather
-- than being silently picked up from ready.  The actor, reason and scope are
-- validated server-side and the existing approval trigger creates one pending
-- approval record idempotently.
create or replace function public.submit_system_work_item_for_review(
  target_work_key text,
  target_reason text
)
returns table(result_status text, work_key text)
language plpgsql security definer set search_path=public as $$
declare
  item public.system_work_items;
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication_required'; end if;
  if nullif(trim(target_reason),'') is null then raise exception 'submission_reason_required'; end if;

  select * into item from public.system_work_items wi
  where wi.work_key=upper(trim(target_work_key)) for update;
  if item.work_key is null then raise exception 'work_item_not_found'; end if;
  if not ((item.company_id is null and exists(select 1 from public.profiles p where p.id=actor and p.role='admin'))
    or (item.company_id is not null and public.is_company_manager(item.company_id))) then
    raise exception 'review_submission_not_allowed';
  end if;
  if item.status <> 'ready' then raise exception 'work_item_not_ready'; end if;
  if item.worker_id is not null or item.lease_expires_at is not null
    or exists(select 1 from public.system_worker_runs r where r.work_key=item.work_key and r.status='running') then
    raise exception 'active_worker_lease_present';
  end if;

  update public.system_work_items
  set status='review', production_status='awaiting_approval',
      current_step='ส่งขออนุมัติแล้ว', updated_by=actor, updated_at=now(),
      evidence=left(concat_ws(E'\n',nullif(evidence,''),'ส่งขออนุมัติโดยผู้มีสิทธิ์: '||left(trim(target_reason),1000)),4000)
  where work_key=item.work_key;
  perform public.request_system_work_item_approval(item.work_key, target_reason);
  return query select 'submitted',item.work_key;
end $$;

-- Reconcile only an explicitly approved scope back to its approved execution
-- state.  It never resets retry_count, never steals a lease, and requires the
-- caller to provide the current scope fingerprint and a reason.  A genuine
-- retry-cap incident still requires reset_system_work_item_retry after its
-- root cause is fixed.
create or replace function public.reconcile_approved_system_work_item_execution(
  target_work_key text,
  target_approval_fingerprint text,
  target_reason text
)
returns table(result_status text, work_key text, production_status text)
language plpgsql security definer set search_path=public as $$
declare
  item public.system_work_items;
  actor uuid := auth.uid();
  current_fingerprint text;
  old_status text;
  old_production_status text;
begin
  if actor is null then raise exception 'authentication_required'; end if;
  if nullif(trim(target_reason),'') is null then raise exception 'reconciliation_reason_required'; end if;
  select * into item from public.system_work_items wi
  where wi.work_key=upper(trim(target_work_key)) for update;
  if item.work_key is null then raise exception 'work_item_not_found'; end if;
  if not ((item.company_id is null and exists(select 1 from public.profiles p where p.id=actor and p.role='admin'))
    or (item.company_id is not null and public.is_company_manager(item.company_id))) then
    raise exception 'execution_reconciliation_not_allowed';
  end if;
  if item.status not in ('ready','blocked') then raise exception 'work_item_not_reconcilable'; end if;
  if item.worker_id is not null or item.lease_expires_at is not null
    or exists(select 1 from public.system_worker_runs r where r.work_key=item.work_key and r.status='running') then
    raise exception 'active_worker_lease_present';
  end if;
  if item.attempt_count >= 5 then raise exception 'retry_cap_requires_explicit_reset'; end if;
  current_fingerprint := public.system_work_item_scope_fingerprint(item.work_key,item.title,item.category,item.risk,item.detail);
  if item.approval_status <> 'approved'
    or item.approval_fingerprint is distinct from current_fingerprint
    or nullif(trim(target_approval_fingerprint),'') is distinct from current_fingerprint then
    raise exception 'approval_scope_fingerprint_mismatch';
  end if;
  old_status := item.status;
  old_production_status := item.production_status;
  update public.system_work_items
  set status='ready', production_status='approved_for_execution',
      worker_id=null, heartbeat_at=null, lease_expires_at=null,
      current_step='ได้รับอนุมัติแล้ว รอเริ่มดำเนินการ', updated_by=actor, updated_at=now(),
      evidence=left(concat_ws(E'\n',nullif(evidence,''),'กู้สถานะ execution ที่อนุมัติแล้ว: '||left(trim(target_reason),1000)),4000),
      worker_outcome='acknowledged', worker_outcome_reason='Approval execution reconciled: '||left(trim(target_reason),900), worker_outcome_at=now()
  where work_key=item.work_key;
  insert into public.system_work_item_events(work_key,event_type,old_status,new_status,old_progress,new_progress,note,actor_id)
  values(item.work_key,'approval_execution_reconciled',old_status,'ready',item.progress,item.progress,
    left('old_production='||coalesce(old_production_status,'')||'; new_production=approved_for_execution; reason='||trim(target_reason),4000),actor);
  return query select 'reconciled',item.work_key,'approved_for_execution';
end $$;

-- Ensure the specific approval path observes the same bounded attempt guard
-- and writes the start of the outcome contract.
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
  where item.work_key=btrim(target_work_key) and item.status='ready'
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

-- The runner may finish without an assistant message.  Record that fact rather
-- than leaving a silently failed `running` or generic blocked entry.
drop function if exists public.finish_system_work_item(uuid,text,text,smallint,text,text,text);
create or replace function public.finish_system_work_item(
  target_run uuid, target_worker text, target_status text, target_progress smallint,
  target_evidence text, target_production_status text default null,
  target_error_fingerprint text default null, target_outcome text default null,
  target_outcome_reason text default null
)
returns boolean language plpgsql security definer set search_path=public as $$
declare target_key text; run_status text; resolved_outcome text; resolved_reason text;
begin
  if target_status not in ('ready','review','done','blocked') then raise exception 'invalid_finish_status'; end if;
  if target_progress < 0 or target_progress > 100 then raise exception 'invalid_progress'; end if;
  resolved_outcome:=coalesce(nullif(trim(target_outcome),''),case when target_status='done' then 'completed' when target_status='blocked' then 'blocked' else 'acknowledged' end);
  if resolved_outcome not in ('acknowledged','blocked','completed','no_output') then raise exception 'invalid_worker_outcome'; end if;
  if target_status='done' and resolved_outcome <> 'completed' then raise exception 'completed_outcome_required'; end if;
  if target_status='blocked' and resolved_outcome not in ('blocked','no_output') then raise exception 'blocked_or_no_output_required'; end if;
  resolved_reason:=left(coalesce(nullif(trim(target_outcome_reason),''),nullif(trim(target_evidence),''),'Worker finished without a message.'),1000);
  run_status:=case when target_status='blocked' then 'failed' else 'completed' end;
  update public.system_worker_runs set status=run_status,progress=target_progress,heartbeat_at=now(),finished_at=now(),
    evidence=left(target_evidence,4000),error_fingerprint=left(target_error_fingerprint,200),outcome=resolved_outcome,outcome_reason=resolved_reason
  where id=target_run and worker_id=target_worker and status='running' returning work_key into target_key;
  if target_key is null then return false; end if;
  update public.system_work_items item set status=target_status,progress=target_progress,evidence=left(target_evidence,4000),
    production_status=coalesce(nullif(target_production_status,''),item.production_status),
    error_fingerprint=left(target_error_fingerprint,200),worker_id=null,heartbeat_at=null,lease_expires_at=null,current_step=null,
    worker_outcome=resolved_outcome,worker_outcome_reason=resolved_reason,worker_outcome_at=now(),
    blocked_since=case when target_status='blocked' then coalesce(item.blocked_since,now()) else null end,updated_at=now()
  where item.work_key=target_key;
  return true;
end $$;

-- Keep generic dispatch on the same outcome contract.  The eligibility and
-- approval conditions intentionally match the existing bounded-claim policy.
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
  where item.status='ready' and coalesce(item.production_status,'') <> 'awaiting_approval' and item.attempt_count<max_attempts
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

-- Stale worker leases are an explicit no-output outcome, never an invisible
-- state transition.  The existing recovery function remains the owner of the
-- requeue behavior; this trigger-like replacement only adds durable evidence.
create or replace function public.recover_stale_system_work_items(stale_after_minutes integer default 10)
returns integer language plpgsql security definer set search_path=public as $$
declare stale_cutoff timestamptz; expired_runs integer:=0; recovered_items integer:=0; released_claims integer:=0; retry_items integer:=0;
begin
  if stale_after_minutes < 2 or stale_after_minutes > 120 then raise exception 'invalid_stale_after_minutes'; end if;
  stale_cutoff:=now()-make_interval(mins=>stale_after_minutes);
  update public.system_worker_runs run set status='expired',finished_at=now(),outcome='no_output',outcome_reason='Worker heartbeat expired before a terminal response.',
    evidence=left(concat_ws(E'\n',nullif(run.evidence,''),'Auto-recovery: worker heartbeat expired without terminal output.'),4000)
  where run.status='running' and run.heartbeat_at<stale_cutoff;
  get diagnostics expired_runs=row_count;
  update public.system_work_items item set status='ready',worker_id=null,heartbeat_at=null,lease_expires_at=null,current_step=null,
    worker_outcome='no_output',worker_outcome_reason='Worker heartbeat expired before a terminal response.',worker_outcome_at=now(),
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'Auto-recovery: stale or orphan doing item returned to queue.'),4000),updated_at=now()
  where item.status='doing' and (item.worker_id is null or item.heartbeat_at is null or item.heartbeat_at<stale_cutoff or (item.lease_expires_at is not null and item.lease_expires_at<now()))
    and not exists(select 1 from public.system_worker_runs active_run where active_run.work_key=item.work_key and active_run.status='running' and active_run.heartbeat_at>=stale_cutoff);
  get diagnostics recovered_items=row_count;
  update public.system_work_items item set worker_id=null,heartbeat_at=null,lease_expires_at=null,
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'Auto-recovery: released orphaned claim on a non-doing item (lease/heartbeat expired); status left unchanged.'),4000),updated_at=now()
  where item.status<>'doing' and item.worker_id is not null and (item.heartbeat_at is null or item.heartbeat_at<stale_cutoff or (item.lease_expires_at is not null and item.lease_expires_at<now()));
  get diagnostics released_claims=row_count;
  update public.system_work_items item set status='ready',worker_id=null,heartbeat_at=null,lease_expires_at=null,current_step=null,blocked_since=null,
    production_status='retry_after_runner_fix',worker_outcome='acknowledged',worker_outcome_reason='Legacy runner failure requeued once after corrected runner handling.',worker_outcome_at=now(),
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'Auto-recovery: retry after replacing unsupported Codex CLI option.'),4000),updated_at=now()
  where item.status='blocked' and item.production_status='local_runner_failed' and item.evidence ilike '%--ask-for-approval%';
  get diagnostics retry_items=row_count;
  return expired_runs+recovered_items+released_claims+retry_items;
end $$;

revoke all on function public.submit_system_work_item_for_review(text,text) from public,anon;
revoke all on function public.reconcile_approved_system_work_item_execution(text,text,text) from public,anon;
revoke all on function public.claim_specific_system_work_item(text,text,integer) from public,anon,authenticated;
revoke all on function public.finish_system_work_item(uuid,text,text,smallint,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_system_work_item(text,integer,integer) from public,anon,authenticated;
grant execute on function public.submit_system_work_item_for_review(text,text) to authenticated;
grant execute on function public.reconcile_approved_system_work_item_execution(text,text,text) to authenticated;
grant execute on function public.claim_specific_system_work_item(text,text,integer) to service_role;
grant execute on function public.finish_system_work_item(uuid,text,text,smallint,text,text,text,text,text) to service_role;
grant execute on function public.claim_system_work_item(text,integer,integer) to service_role;

notify pgrst,'reload schema';
