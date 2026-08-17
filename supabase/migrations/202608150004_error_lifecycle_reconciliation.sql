-- SYS-004: reconcile recovered health/client errors independently from incident rows.
create or replace function public.reconcile_system_error_events(
  target_company_id uuid,
  target_healthy_fingerprints text[],
  target_client_recovery_cutoff timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  health_resolved integer := 0;
  client_resolved integer := 0;
begin
  if target_company_id is null then
    raise exception 'company is required';
  end if;

  update public.system_error_events event
  set status='resolved',
      resolution_reason='Health monitor recovered and the latest check is healthy.',
      resolved_at=now(),resolved_by=null,updated_at=now()
  where event.company_id=target_company_id
    and event.status in ('open','monitoring')
    and event.fingerprint=any(coalesce(target_healthy_fingerprints,array[]::text[]));
  get diagnostics health_resolved=row_count;

  if target_client_recovery_cutoff is not null then
    update public.system_error_events event
    set status='resolved',
        resolution_reason='Client monitor found no new errors during the verification window.',
        resolved_at=now(),resolved_by=null,updated_at=now()
    where event.company_id=target_company_id
      and event.status in ('open','monitoring')
      and event.first_source like 'web:%'
      and event.last_seen_at<=target_client_recovery_cutoff;
    get diagnostics client_resolved=row_count;
  end if;

  return jsonb_build_object(
    'health_resolved',health_resolved,
    'client_resolved',client_resolved,
    'total_resolved',health_resolved+client_resolved
  );
end $$;

revoke all on function public.reconcile_system_error_events(uuid,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_system_error_events(uuid,text[],timestamptz) to service_role;

-- Reconcile existing rows using the latest authoritative check state. This is
-- deliberately scoped by company and records an automatic audit reason.
with healthy as (
  select check_row.company_id,
         array_agg(lower('health:'||check_row.module||':'||check_row.check_key)) as fingerprints
  from public.health_monitor_checks check_row
  where check_row.company_id is not null and check_row.status='healthy'
  group by check_row.company_id
)
update public.system_error_events event
set status='resolved',
    resolution_reason='Migration reconciliation: latest health check is healthy.',
    resolved_at=now(),resolved_by=null,updated_at=now()
from healthy
where event.company_id=healthy.company_id
  and event.status in ('open','monitoring')
  and event.fingerprint=any(healthy.fingerprints);

update public.system_error_events event
set status='resolved',
    resolution_reason='Migration reconciliation: no repeat client error in the verification window.',
    resolved_at=now(),resolved_by=null,updated_at=now()
where event.status in ('open','monitoring')
  and event.first_source like 'web:%'
  and event.last_seen_at<=now()-interval '15 minutes'
  and exists(
    select 1 from public.health_monitor_checks check_row
    where check_row.company_id=event.company_id
      and check_row.check_key='client_errors'
      and check_row.status='healthy'
      and check_row.last_checked_at>event.last_seen_at
  );

select public.reconcile_system_error_work_item();
