-- PAYROLL-FORECAST-001: close the existing work item after explicit Admin UAT approval.
do $$
begin
  if exists (
    select 1 from public.system_worker_runs
    where status = 'running'
      and heartbeat_at >= now() - interval '10 minutes'
  ) then
    raise exception 'active_worker_run_exists';
  end if;

  update public.system_work_items
  set status = 'done',
      progress = 100,
      current_step = 'completed',
      production_status = 'deployed_uat_approved',
      approval_status = 'approved',
      approval_channel = 'web_admin',
      approved_at = now(),
      worker_id = null,
      heartbeat_at = null,
      lease_expires_at = null,
      evidence = concat_ws(
        E'\n',
        nullif(evidence, ''),
        'Admin explicitly approved PAYROLL-FORECAST-001 as done 100% after Production UI and individual PDF UAT.'
      ),
      updated_at = now()
  where work_key = 'PAYROLL-FORECAST-001'
    and status = 'review';

  if not found then
    raise exception 'payroll_forecast_review_item_not_found';
  end if;
end $$;
