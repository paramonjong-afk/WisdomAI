-- SYS-010: secure queue leasing and worker heartbeat for background automation.

alter table public.system_work_items
  add column if not exists worker_id text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists current_step text,
  add column if not exists attempt_count integer not null default 0;

create index if not exists system_work_items_worker_queue_idx
  on public.system_work_items(status, lease_expires_at, risk, updated_at);

create table if not exists public.system_worker_runs (
  id uuid primary key default gen_random_uuid(),
  work_key text not null references public.system_work_items(work_key) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  worker_id text not null,
  status text not null check(status in ('running','completed','failed','expired')),
  current_step text,
  progress smallint not null default 0 check(progress between 0 and 100),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  evidence text,
  error_fingerprint text
);

create index if not exists system_worker_runs_active_idx
  on public.system_worker_runs(status, heartbeat_at) where status='running';
create index if not exists system_worker_runs_work_idx
  on public.system_worker_runs(work_key, started_at desc);

alter table public.system_worker_runs enable row level security;
create policy "Platform admins read worker runs" on public.system_worker_runs
  for select to authenticated using(
    exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
    or (company_id is not null and public.is_company_manager(company_id))
  );
revoke insert,update,delete on public.system_worker_runs from anon,authenticated;

create or replace function public.claim_system_work_item(target_worker text, lease_minutes integer default 15)
returns table(work_key text,title text,category text,risk text,detail text,progress smallint,company_id uuid,run_id uuid)
language plpgsql security definer set search_path=public as $$
declare selected public.system_work_items;
declare selected_run uuid;
begin
  if nullif(trim(target_worker),'') is null then raise exception 'worker_id_required'; end if;
  if lease_minutes < 5 or lease_minutes > 120 then raise exception 'invalid_lease_minutes'; end if;

  select * into selected from public.system_work_items item
  where item.status='ready'
     or (item.status='doing' and item.lease_expires_at is not null and item.lease_expires_at < now())
  order by
    case item.risk when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
    item.updated_at,
    item.work_key
  for update skip locked limit 1;

  if not found then return; end if;

  update public.system_worker_runs
    set status='expired',finished_at=now(),evidence=coalesce(evidence,'') || E'\nLease expired; returned to queue.'
    where work_key=selected.work_key and status='running';

  insert into public.system_worker_runs(work_key,company_id,worker_id,status,current_step,progress)
    values(selected.work_key,selected.company_id,trim(target_worker),'running','claimed',selected.progress)
    returning id into selected_run;

  update public.system_work_items item set
    status='doing',worker_id=trim(target_worker),heartbeat_at=now(),
    lease_expires_at=now()+make_interval(mins=>lease_minutes),current_step='claimed',
    attempt_count=item.attempt_count+1,updated_at=now(),
    evidence='Claimed by automation worker; run_id=' || selected_run::text
  where item.work_key=selected.work_key;

  return query select selected.work_key,selected.title,selected.category,selected.risk,
    selected.detail,selected.progress,selected.company_id,selected_run;
end $$;

create or replace function public.heartbeat_system_work_item(
  target_run uuid,target_worker text,target_step text,target_progress smallint,lease_minutes integer default 15
) returns boolean language plpgsql security definer set search_path=public as $$
declare target_key text;
begin
  if target_progress < 0 or target_progress > 100 then raise exception 'invalid_progress'; end if;
  update public.system_worker_runs set heartbeat_at=now(),current_step=left(target_step,500),progress=target_progress
    where id=target_run and worker_id=target_worker and status='running'
    returning work_key into target_key;
  if target_key is null then return false; end if;
  update public.system_work_items set heartbeat_at=now(),lease_expires_at=now()+make_interval(mins=>lease_minutes),
    current_step=left(target_step,500),progress=greatest(progress,target_progress),updated_at=now()
    where work_key=target_key and worker_id=target_worker and status='doing';
  return found;
end $$;

create or replace function public.finish_system_work_item(
  target_run uuid,target_worker text,target_status text,target_progress smallint,
  target_evidence text,target_production_status text default null,target_error_fingerprint text default null
) returns boolean language plpgsql security definer set search_path=public as $$
declare target_key text;
declare run_status text;
begin
  if target_status not in ('ready','review','done','blocked') then raise exception 'invalid_finish_status'; end if;
  if target_progress < 0 or target_progress > 100 then raise exception 'invalid_progress'; end if;
  run_status:=case when target_status='done' then 'completed' when target_status='blocked' then 'failed' else 'completed' end;
  update public.system_worker_runs set status=run_status,progress=target_progress,heartbeat_at=now(),finished_at=now(),
    evidence=left(target_evidence,4000),error_fingerprint=left(target_error_fingerprint,200)
    where id=target_run and worker_id=target_worker and status='running'
    returning work_key into target_key;
  if target_key is null then return false; end if;
  update public.system_work_items set status=target_status,progress=target_progress,evidence=left(target_evidence,4000),
    production_status=coalesce(nullif(target_production_status,''),production_status),worker_id=null,
    heartbeat_at=null,lease_expires_at=null,current_step=null,updated_at=now()
    where work_key=target_key and worker_id=target_worker and status='doing';
  return found;
end $$;

revoke all on function public.claim_system_work_item(text,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_system_work_item(uuid,text,text,smallint,integer) from public,anon,authenticated;
revoke all on function public.finish_system_work_item(uuid,text,text,smallint,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_system_work_item(text,integer) to service_role;
grant execute on function public.heartbeat_system_work_item(uuid,text,text,smallint,integer) to service_role;
grant execute on function public.finish_system_work_item(uuid,text,text,smallint,text,text,text) to service_role;

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,production_status)
values('SYS-010','Automation Worker และ Worker heartbeat','automation','doing',70,'high',
  'Secure atomic claim, lease, heartbeat, stale recovery and append-only run evidence.','migration_pending')
on conflict(work_key) do update set status='doing',progress=70,detail=excluded.detail,
  production_status='migration_pending',updated_at=now();

comment on table public.system_worker_runs is 'Append-only execution evidence for secure automation workers.';
