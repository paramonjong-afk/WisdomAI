begin;

alter table public.system_work_items
  add column if not exists approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists approval_scope text,
  add column if not exists approval_fingerprint text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approval_channel text;

create or replace function public.system_work_item_scope_fingerprint(
  target_work_key text,
  target_title text,
  target_category text,
  target_risk text,
  target_detail text
) returns text
language sql immutable
set search_path = public
as $$
  select md5(concat_ws(chr(31),
    coalesce(target_work_key, ''), coalesce(target_title, ''),
    coalesce(target_category, ''), coalesce(target_risk, ''),
    coalesce(target_detail, '')
  ));
$$;

create or replace function public.sync_system_work_item_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_fingerprint text;
begin
  current_fingerprint := public.system_work_item_scope_fingerprint(
    new.work_key, new.title, new.category, new.risk, new.detail
  );

  if tg_op = 'UPDATE' and (
    new.title is distinct from old.title
    or new.category is distinct from old.category
    or new.risk is distinct from old.risk
    or new.detail is distinct from old.detail
  ) then
    new.approval_status := 'pending';
    new.approval_scope := null;
    new.approval_fingerprint := null;
    new.approved_at := null;
    new.approved_by := null;
    new.approval_channel := null;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'review'
     and new.status = 'ready'
     and new.production_status = 'approved_for_execution' then
    new.approval_status := 'approved';
    new.approval_scope := coalesce(nullif(new.current_step, ''), new.title);
    new.approval_fingerprint := current_fingerprint;
    new.approved_at := now();
    new.approved_by := auth.uid();
    new.approval_channel := coalesce(nullif(new.approval_channel, ''), 'admin_action');
  elsif tg_op = 'UPDATE'
     and old.status = 'review'
     and new.status = 'blocked'
     and new.production_status = 'rejected_by_admin' then
    new.approval_status := 'rejected';
    new.approval_scope := coalesce(nullif(new.current_step, ''), new.title);
    new.approval_fingerprint := current_fingerprint;
    new.approved_at := now();
    new.approved_by := auth.uid();
    new.approval_channel := coalesce(nullif(new.approval_channel, ''), 'admin_action');
  end if;

  return new;
end;
$$;

drop trigger if exists sync_system_work_item_approval_trigger on public.system_work_items;
create trigger sync_system_work_item_approval_trigger
before insert or update on public.system_work_items
for each row execute function public.sync_system_work_item_approval();

drop function if exists public.claim_system_work_item(text, integer);

create function public.claim_system_work_item(target_worker text, lease_minutes integer default 15)
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

  perform public.recover_stale_system_work_items(10);

  select item.* into selected
  from public.system_work_items as item
  where item.status = 'ready'
    and coalesce(item.production_status, '') <> 'awaiting_approval'
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
      attempt_count = item.attempt_count + 1, updated_at = now(),
      evidence = left(concat_ws(E'\n', nullif(item.evidence, ''), 'Claimed by automation worker; run_id=' || selected_run::text), 4000)
  where item.work_key = selected.work_key;

  return query
  select selected.work_key, selected.title, selected.category, selected.risk,
         selected.detail, selected.progress, selected.company_id, selected_run,
         selected.approval_status, selected.approval_fingerprint;
end;
$$;

revoke all on function public.claim_system_work_item(text, integer) from public, anon, authenticated;
grant execute on function public.claim_system_work_item(text, integer) to service_role;

update public.system_work_items
set status = 'done', progress = 100,
    current_step = 'multi_company_audit_completed',
    production_status = 'audit_completed_followup_uat_deferred',
    evidence = left(concat_ws(E'\n', nullif(evidence, ''),
      '11/8/2569: approval-loop reconciled. Multi-company audit completed; deferred UAT remains evidence only and does not block closure.'), 4000),
    worker_id = null, heartbeat_at = null, lease_expires_at = null,
    approval_status = 'approved', approval_scope = 'Complete AUD-001 multi-company audit',
    approval_fingerprint = public.system_work_item_scope_fingerprint(work_key,title,category,risk,detail),
    approved_at = now(), approval_channel = 'explicit_user_approval', updated_at = now()
where work_key = 'AUD-001';

update public.system_work_items
set status = 'ready', progress = 0,
    current_step = 'approved_scope_ready_for_execution',
    production_status = 'approved_for_execution',
    evidence = left(concat_ws(E'\n', nullif(evidence, ''),
      '11/8/2569: restored to ready using the existing explicit approval; duplicate approval is not required while scope is unchanged.'), 4000),
    worker_id = null, heartbeat_at = null, lease_expires_at = null,
    approval_status = 'approved', approval_scope = 'Repair Drawing AI Edge and analysis',
    approval_fingerprint = public.system_work_item_scope_fingerprint(work_key,title,category,risk,detail),
    approved_at = now(), approval_channel = 'explicit_user_approval', updated_at = now()
where work_key = 'TEN-003';

commit;
