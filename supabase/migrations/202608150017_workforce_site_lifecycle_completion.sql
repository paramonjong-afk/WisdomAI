-- WORKFORCE-SITE-LIFECYCLE-001: reconcile the authoritative work item after
-- the previously approved lifecycle migration, regression checks, and
-- authenticated Production smoke test passed.
-- This updates the existing platform row only and does not mutate assignment
-- history or any tenant-owned workforce record.

update public.system_work_items
set status = 'done',
    progress = 100,
    detail = 'Completed: site assignments support audited update, move, end, and void workflows without hard-deleting history.',
    current_step = 'completed',
    production_status = 'deployed_uat_passed',
    evidence = concat_ws(
      E'\n',
      nullif(evidence, ''),
      'Migration 202608120005 is present on Production. Site-assignment lifecycle regression, lint, and build passed. Authenticated Workforce Setup smoke showed active assignment history and per-row management controls for WisdomAI Construction; tenant isolation, required reasons, attendance-use void protection, and no hard delete remain enforced.'
    ),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'WORKFORCE-SITE-LIFECYCLE-001'
  and scope = 'platform'
  and status = 'review'
  and progress = 90;

do $$
begin
  if not exists (
    select 1
    from public.system_work_items
    where work_key = 'WORKFORCE-SITE-LIFECYCLE-001'
      and scope = 'platform'
      and status = 'done'
      and progress = 100
      and production_status = 'deployed_uat_passed'
  ) then
    raise exception 'WORKFORCE-SITE-LIFECYCLE-001 completion reconciliation failed';
  end if;
end
$$;
