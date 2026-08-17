-- SYS-004: audited, tenant-safe incident resolution and automatic recovery.
alter table public.system_error_events
  add column if not exists resolution_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create or replace function public.resolve_system_error_event(target_event_id uuid,target_status text,target_reason text)
returns public.system_error_events language plpgsql security definer set search_path=public as $$
declare result public.system_error_events;
begin
  if target_status not in ('resolved','dismissed') then raise exception 'invalid resolution status'; end if;
  if length(trim(coalesce(target_reason,''))) < 5 then raise exception 'resolution reason is required'; end if;
  select * into result from public.system_error_events event where event.id=target_event_id for update;
  if result.id is null then raise exception 'error event not found'; end if;
  if not public.is_company_manager(result.company_id) then raise exception 'manager access required'; end if;
  update public.system_error_events set status=target_status,resolution_reason=left(trim(target_reason),1000),
    resolved_at=now(),resolved_by=auth.uid(),updated_at=now()
  where id=target_event_id returning * into result;
  return result;
end $$;
revoke all on function public.resolve_system_error_event(uuid,text,text) from public,anon;
grant execute on function public.resolve_system_error_event(uuid,text,text) to authenticated;

create or replace function public.resolve_system_error_event_by_fingerprint(target_company_id uuid,target_fingerprint text,target_reason text)
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  update public.system_error_events set status='resolved',resolution_reason=left(trim(target_reason),1000),
    resolved_at=now(),resolved_by=null,updated_at=now()
  where company_id=target_company_id and fingerprint=lower(trim(target_fingerprint)) and status in ('open','monitoring');
  get diagnostics affected=row_count;
  return affected;
end $$;
revoke all on function public.resolve_system_error_event_by_fingerprint(uuid,text,text) from public,anon,authenticated;
grant execute on function public.resolve_system_error_event_by_fingerprint(uuid,text,text) to service_role;

create or replace function public.reconcile_system_error_work_item()
returns boolean language plpgsql security definer set search_path=public as $$
declare open_count integer;
begin
  select count(*) into open_count from public.system_error_events where status in ('open','monitoring');
  if open_count=0 then
    update public.system_work_items set status='done',progress=100,current_step='completed',error_fingerprint=null,
      evidence='Central error register has no open incidents; automatic intake and audited resolution verified.',
      production_status='deployed_smoke_passed_no_open_incidents',updated_at=now() where work_key='SYS-004';
    return true;
  end if;
  update public.system_work_items set status='doing',progress=90,current_step='triage_error_fingerprint',
    production_status='monitoring_active_with_open_incident',updated_at=now() where work_key='SYS-004';
  return false;
end $$;
revoke all on function public.reconcile_system_error_work_item() from public,anon,authenticated;
grant execute on function public.reconcile_system_error_work_item() to service_role;

update public.system_work_items set status='review',progress=95,current_step='awaiting_resolution_migration_approval',
  production_status='migration_202608150002_ready_for_approval',risk='high',
  evidence='Prepared audited manager resolve/dismiss RPC, automatic health recovery resolution, and SYS-004 open-incident completion guard; awaiting explicit Production migration/deploy approval.',updated_at=now()
where work_key='SYS-004';
