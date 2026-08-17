-- Remove expected Auth outcomes from the central incident register and reconcile SYS-004.
-- Scope is restricted to tenants that currently have the exact Auth token false positive.
with affected_companies as (
  select distinct company_id
  from public.system_error_events
  where status in ('open', 'monitoring')
    and lower(affected_module) like '%/auth/v1/token%'
    and message ~ '^(400|401) '
), dismissed_auth as (
  update public.system_error_events event
  set status = 'dismissed',
      resolution_reason = 'Expected authentication rejection (HTTP 400/401); login endpoint remained available and this outcome is excluded from outage telemetry.',
      resolved_at = now(),
      resolved_by = null
  where event.company_id in (select company_id from affected_companies)
    and event.status in ('open', 'monitoring')
    and lower(event.affected_module) like '%/auth/v1/token%'
    and event.message ~ '^(400|401) '
  returning event.company_id
)
update public.system_error_events event
set status = 'dismissed',
    resolution_reason = 'Derived client warning contained only expected Auth rejection events; reconciled after telemetry exclusion.',
    resolved_at = now(),
    resolved_by = null
where event.company_id in (select company_id from dismissed_auth)
  and event.status in ('open', 'monitoring')
  and event.fingerprint in ('health:client:client_errors', 'health:client_errors');

select public.reconcile_system_error_work_item();
