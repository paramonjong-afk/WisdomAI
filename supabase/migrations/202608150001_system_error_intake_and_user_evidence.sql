-- SYS-004: one tenant-safe intake for automatic errors and user screenshot evidence.

create table if not exists public.system_error_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  fingerprint text not null,
  correlation_key text not null,
  severity text not null default 'error' check (severity in ('warning','error','critical')),
  status text not null default 'open' check (status in ('open','monitoring','resolved','dismissed')),
  title text not null,
  message text,
  affected_module text,
  first_source text not null,
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  system_occurrence_count integer not null default 0 check (system_occurrence_count >= 0),
  user_report_count integer not null default 0 check (user_report_count >= 0),
  confirmed_by_user_at timestamptz,
  last_evidence_message_id uuid references public.line_messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,fingerprint)
);

create index if not exists system_error_events_company_status_seen_idx
  on public.system_error_events(company_id,status,last_seen_at desc);
create index if not exists system_error_events_company_correlation_idx
  on public.system_error_events(company_id,correlation_key,last_seen_at desc);

alter table public.system_error_events enable row level security;
drop policy if exists tenant_managers_read_system_error_events on public.system_error_events;
create policy tenant_managers_read_system_error_events on public.system_error_events
for select to authenticated using(public.is_company_manager(company_id));

create or replace function public.upsert_system_error_event(
  target_company_id uuid,
  target_fingerprint text,
  target_correlation_key text,
  target_source text,
  target_title text,
  target_message text default null,
  target_module text default null,
  target_severity text default 'error',
  target_metadata jsonb default '{}'::jsonb,
  target_evidence_message_id uuid default null,
  target_is_user_report boolean default false
) returns public.system_error_events
language plpgsql security definer set search_path=public as $$
declare
  result public.system_error_events;
  normalized_fingerprint text := left(lower(trim(target_fingerprint)),200);
  normalized_correlation text := left(lower(trim(target_correlation_key)),300);
begin
  if target_company_id is null or normalized_fingerprint='' or normalized_correlation='' then
    raise exception 'company, fingerprint and correlation key are required';
  end if;
  if target_severity not in ('warning','error','critical') then raise exception 'invalid severity'; end if;

  -- A screenshot may use a different image hash; correlate it to a recent open
  -- automatic incident before considering a new fingerprint.
  if target_is_user_report then
    select * into result from public.system_error_events event
    where event.company_id=target_company_id
      and event.status in ('open','monitoring')
      and (
        event.fingerprint=normalized_fingerprint
        or event.correlation_key=normalized_correlation
        or (
          target_module is not null and lower(coalesce(event.affected_module,''))=lower(target_module)
          and nullif(target_metadata->>'error_code','') is not null
          and lower(coalesce(event.metadata->>'error_code',''))=lower(target_metadata->>'error_code')
        )
      )
      and event.last_seen_at >= now()-interval '30 days'
    order by (event.fingerprint=normalized_fingerprint) desc,event.last_seen_at desc limit 1
    for update;
  else
    select * into result from public.system_error_events event
    where event.company_id=target_company_id and event.fingerprint=normalized_fingerprint
    for update;
  end if;

  if result.id is null then
    insert into public.system_error_events(
      company_id,fingerprint,correlation_key,severity,title,message,affected_module,first_source,
      system_occurrence_count,user_report_count,confirmed_by_user_at,last_evidence_message_id,metadata
    ) values (
      target_company_id,normalized_fingerprint,normalized_correlation,target_severity,left(target_title,300),left(target_message,1000),
      left(target_module,160),left(target_source,80),case when target_is_user_report then 0 else 1 end,
      case when target_is_user_report then 1 else 0 end,case when target_is_user_report then now() end,
      target_evidence_message_id,coalesce(target_metadata,'{}'::jsonb)
    )
    on conflict(company_id,fingerprint) do update set
      occurrence_count=system_error_events.occurrence_count+1,
      system_occurrence_count=system_error_events.system_occurrence_count+case when target_is_user_report then 0 else 1 end,
      user_report_count=system_error_events.user_report_count+case when target_is_user_report then 1 else 0 end,
      confirmed_by_user_at=case when target_is_user_report then now() else system_error_events.confirmed_by_user_at end,
      last_evidence_message_id=coalesce(target_evidence_message_id,system_error_events.last_evidence_message_id),
      severity=case when target_severity='critical' then 'critical' when system_error_events.severity='critical' then system_error_events.severity else target_severity end,
      message=coalesce(left(target_message,1000),system_error_events.message),
      metadata=system_error_events.metadata||coalesce(target_metadata,'{}'::jsonb),
      status=case when system_error_events.status='resolved' then 'monitoring' else system_error_events.status end,
      last_seen_at=now(),updated_at=now()
    returning * into result;
  else
    update public.system_error_events set
      occurrence_count=occurrence_count+1,
      system_occurrence_count=system_occurrence_count+case when target_is_user_report then 0 else 1 end,
      user_report_count=user_report_count+case when target_is_user_report then 1 else 0 end,
      confirmed_by_user_at=case when target_is_user_report then now() else confirmed_by_user_at end,
      last_evidence_message_id=coalesce(target_evidence_message_id,last_evidence_message_id),
      severity=case when target_severity='critical' then 'critical' when severity='critical' then severity else target_severity end,
      message=coalesce(left(target_message,1000),message),metadata=metadata||coalesce(target_metadata,'{}'::jsonb),
      status=case when status='resolved' then 'monitoring' else status end,last_seen_at=now(),updated_at=now()
    where id=result.id returning * into result;
  end if;

  update public.system_work_items set
    status=case when status='done' then 'doing' else status end,
    progress=least(progress,90),risk=case when target_severity='critical' then 'high' else 'medium' end,
    current_step='triage_error_fingerprint',error_fingerprint=result.fingerprint,
    evidence=left('Error intake: '||result.fingerprint||'; system='||result.system_occurrence_count||'; user evidence='||result.user_report_count||'; last source='||target_source,4000),
    production_status='monitoring_active_with_open_incident',updated_at=now()
  where work_key='SYS-004';
  return result;
end $$;

revoke all on function public.upsert_system_error_event(uuid,text,text,text,text,text,text,text,jsonb,uuid,boolean) from public,anon,authenticated;
grant execute on function public.upsert_system_error_event(uuid,text,text,text,text,text,text,text,jsonb,uuid,boolean) to service_role;

create or replace function public.register_client_error_event(
  target_fingerprint text,target_correlation_key text,target_source text,target_title text,
  target_message text default null,target_module text default null,target_severity text default 'error',
  target_metadata jsonb default '{}'::jsonb
) returns public.system_error_events
language plpgsql security definer set search_path=public as $$
declare company uuid; result public.system_error_events;
begin
  select preference.active_company_id into company from public.user_company_preferences preference
  where preference.profile_id=auth.uid();
  if company is null or not exists(select 1 from public.company_members member where member.company_id=company and member.profile_id=auth.uid() and member.active) then
    raise exception 'active company membership required';
  end if;
  select * into result from public.upsert_system_error_event(company,target_fingerprint,target_correlation_key,target_source,
    target_title,target_message,target_module,target_severity,target_metadata||jsonb_build_object('profile_id',auth.uid()),null,false);
  return result;
end $$;

revoke all on function public.register_client_error_event(text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.register_client_error_event(text,text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.get_system_error_statistics()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare company uuid; result jsonb;
begin
  select preference.active_company_id into company from public.user_company_preferences preference where preference.profile_id=auth.uid();
  if company is null or not exists(select 1 from public.company_members member where member.company_id=company and member.profile_id=auth.uid() and member.active) then
    raise exception 'active company membership required';
  end if;
  select jsonb_build_object(
    'open_incidents',count(*) filter(where status in ('open','monitoring')),
    'critical_open',count(*) filter(where status in ('open','monitoring') and severity='critical'),
    'incidents_24h',count(*) filter(where last_seen_at>=now()-interval '24 hours'),
    'incidents_7d',count(*) filter(where last_seen_at>=now()-interval '7 days'),
    'system_occurrences',coalesce(sum(system_occurrence_count),0),
    'user_confirmations',coalesce(sum(user_report_count),0),
    'repeated_incidents',count(*) filter(where occurrence_count>1),
    'affected_modules',count(distinct affected_module) filter(where affected_module is not null and status in ('open','monitoring')),
    'generated_at',now()
  ) into result from public.system_error_events where company_id=company;
  return result;
end $$;

revoke all on function public.get_system_error_statistics() from public,anon;
grant execute on function public.get_system_error_statistics() to authenticated;

update public.system_work_items set status='review',progress=80,current_step='awaiting_migration_and_deploy_approval',
  production_status='migration_ready_for_production',risk='high',
  detail='Central tenant-safe automatic error intake with fingerprint dedupe and LINE screenshot evidence correlation.',
  evidence='Migration 202608150001 prepared; requires approval before Production migration and Edge/Web deploy.',updated_at=now()
where work_key='SYS-004';
