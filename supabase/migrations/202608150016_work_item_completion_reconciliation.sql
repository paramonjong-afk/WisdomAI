-- LINE-GROUP-APPROVAL-001: reconcile the authoritative work item after the
-- approved Production migration and signed-in tenant-assignment UAT passed.
-- This updates the existing platform-scoped row only; it does not create a
-- duplicate work item or change any tenant-owned business data.

update public.system_work_items
set status = 'done',
    progress = 100,
    detail = 'Completed: unknown LINE groups are quarantined until a Platform Admin selects the owning company.',
    current_step = 'completed',
    production_status = 'deployed_assignment_uat_passed',
    evidence = concat_ws(
      E'\n',
      nullif(evidence, ''),
      'Migration 202608150015 applied to Production. Signed-in Platform Admin UAT assigned Test Line 2 to WisdomAI Construction; the pending assignment disappeared, the active mapping was visible, and pre-assignment tenant quarantine remained enforced.'
    ),
    worker_id = null,
    heartbeat_at = null,
    lease_expires_at = null,
    updated_at = now()
where work_key = 'LINE-GROUP-APPROVAL-001'
  and scope = 'platform'
  and status = 'review'
  and progress = 99;

do $$
begin
  -- A pristine installation has no historical UAT work item to reconcile.
  -- Keep the original assertion for existing identities or any target row.
  if not exists (select 1 from auth.users)
     and not exists (select 1 from public.profiles)
     and not exists (
       select 1 from public.system_work_items
       where work_key = 'LINE-GROUP-APPROVAL-001'
     ) then
    raise notice 'Completion reconciliation not applicable: no users, profiles or target work item exist';
    return;
  end if;

  if not exists (
    select 1
    from public.system_work_items
    where work_key = 'LINE-GROUP-APPROVAL-001'
      and scope = 'platform'
      and status = 'done'
      and progress = 100
      and production_status = 'deployed_assignment_uat_passed'
  ) then
    raise exception 'LINE-GROUP-APPROVAL-001 completion reconciliation failed';
  end if;
end
$$;
