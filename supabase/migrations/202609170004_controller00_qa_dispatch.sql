-- CONTROLLER00-QA-DISPATCH-V1
-- Claim an approved review item for independent, read-only evidence verification.

create or replace function public.claim_system_work_item_qa_v1(
  target_worker text, lease_minutes integer default 30
)
returns table(
  work_key text,title text,category text,risk text,detail text,progress smallint,company_id uuid,run_id uuid,
  approval_status text,approval_fingerprint text,requirement_version integer,checkpoint jsonb,context_manifest jsonb,
  evidence text,control_state text,qa_tier text
)
language plpgsql security definer set search_path=public as $$
declare selected public.system_work_items; selected_run uuid;
begin
  if nullif(trim(target_worker),'') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;
  perform public.recover_stale_system_work_items(10);

  select item.* into selected
  from public.system_work_items item
  where item.status='review'
    and item.approval_status='approved'
    and item.work_kind='executable'
    and item.progress >= 95
    and coalesce(item.qa_tier,'standard') <> 'human'
    and item.worker_id is null
    and not exists(
      select 1 from public.system_worker_runs active
      where active.work_key=item.work_key and active.status='running'
    )
  order by case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    item.updated_at,item.work_key
  for update skip locked limit 1;
  if not found then return; end if;

  insert into public.system_worker_runs(
    work_key,company_id,worker_id,status,current_step,progress,outcome,outcome_reason,
    requirement_version,checkpoint,context_manifest_hash
  ) values(
    selected.work_key,selected.company_id,trim(target_worker),'running','qa_claimed',selected.progress,
    'claimed','Claimed for independent evidence verification.',selected.requirement_version,
    selected.checkpoint,md5(selected.context_manifest::text)
  ) returning id into selected_run;

  update public.system_work_items item
  set status='doing',worker_id=trim(target_worker),heartbeat_at=now(),
      lease_expires_at=now()+make_interval(mins=>lease_minutes),current_step='qa_verifying_evidence',
      qa_owner=trim(target_worker),control_state='active',updated_at=now(),
      worker_outcome='claimed',worker_outcome_reason='Claimed for independent evidence verification.',worker_outcome_at=now()
  where item.work_key=selected.work_key;

  insert into public.system_work_item_events(work_key,company_id,event_type,old_status,new_status,old_progress,new_progress,note)
  values(selected.work_key,selected.company_id,'qa_claimed','review','doing',selected.progress,selected.progress,
    'Independent QA claimed the approved review item; implementation scope is read-only during this run.');

  return query select selected.work_key,selected.title,selected.category,selected.risk,selected.detail,selected.progress,
    selected.company_id,selected_run,selected.approval_status,selected.approval_fingerprint,selected.requirement_version,
    selected.checkpoint,selected.context_manifest,selected.evidence,'active'::text,coalesce(selected.qa_tier,'standard');
end $$;

revoke all on function public.claim_system_work_item_qa_v1(text,integer) from public,anon,authenticated;
grant execute on function public.claim_system_work_item_qa_v1(text,integer) to service_role;

comment on function public.claim_system_work_item_qa_v1(text,integer) is
  'Claims only approved executable review items at >=95% for independent read-only QA. Human-tier review remains human-owned.';

notify pgrst,'reload schema';
