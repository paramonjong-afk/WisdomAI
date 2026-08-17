-- Explicit administrator exception for the TEC administrator profile readiness check.
-- Preserve the event and occurrence history, but do not treat it as an actionable error.
update public.system_error_events
set status='dismissed',
    resolution_reason='Administrator-approved exception: the TEC administrator profile is not an attendance employee and does not require employment, pay-rate, work-policy, or site readiness.',
    resolved_at=now(),
    resolved_by=null,
    updated_at=now()
where company_id='c1f36966-a8a4-4506-8281-7eb6e7e9841e'::uuid
  and fingerprint='health:workforce:employee_readiness'
  and status in ('open','monitoring');

select public.reconcile_system_error_work_item();
