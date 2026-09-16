-- Record Jong's explicit approval for Phase 1 only: POSTING-FLOW-001.
-- This migration refuses to approve if the planned scope or execution state changed.
do $$
declare
  item public.system_work_items;
  current_fingerprint text;
  approval_reason constant text :=
    'Jong explicitly approved Phase 1 POSTING-FLOW-001 on 2026-09-16. Scope is limited to defining the canonical Posting approval/transaction contract; Phases 2-5 remain pending.';
begin
  select * into item
  from public.system_work_items as wi
  where wi.work_key = 'POSTING-FLOW-001'
  for update;

  if item.work_key is null then
    raise exception 'POSTING-FLOW-001 not found';
  end if;

  if item.status <> 'ready'
     or item.progress <> 0
     or item.worker_id is not null
     or item.approval_status <> 'pending'
     or item.production_status <> 'backlog_registered'
     or item.context_manifest ->> 'controller_plan' <> 'CTRL-READY-SEQUENCE-20260916'
     or item.context_manifest ->> 'execution_phase' <> '1'
     or item.context_manifest -> 'depends_on' <> '[]'::jsonb
     or item.current_step <> 'Approve and define the canonical Posting approval/transaction contract.' then
    raise exception 'POSTING-FLOW-001 scope/state changed; policy re-approval required';
  end if;

  current_fingerprint := public.system_work_item_scope_fingerprint(
    item.work_key,
    item.title,
    item.category,
    item.risk,
    item.detail
  );

  update public.system_work_item_approvals
  set status = 'approved',
      decision_channel = 'system',
      decision_reason = approval_reason,
      decided_at = now(),
      updated_at = now()
  where work_key = item.work_key
    and status = 'pending';

  if not found then
    insert into public.system_work_item_approvals(
      work_key,
      company_id,
      status,
      decision_channel,
      decision_reason,
      decided_at
    ) values (
      item.work_key,
      item.company_id,
      'approved',
      'system',
      approval_reason,
      now()
    );
  end if;

  update public.system_work_items
  set production_status = 'approved_for_execution',
      approval_status = 'approved',
      approval_scope = 'Phase 1 only: define the canonical Posting approval/transaction contract',
      approval_fingerprint = current_fingerprint,
      approved_at = now(),
      approval_channel = 'explicit_user_approval_controller_00',
      current_step = 'Phase 1 approved; waiting for an atomic Worker claim.',
      evidence = left(concat_ws(E'\n', nullif(evidence, ''), approval_reason), 4000),
      context_manifest = coalesce(context_manifest, '{}'::jsonb) || jsonb_build_object(
        'approval_receipt', 'CTRL-POSTING-FLOW-001-PHASE1-20260916',
        'approved_scope', 'POSTING-FLOW-001 only',
        'approved_at', now(),
        'phases_2_to_5', 'pending'
      ),
      updated_at = now()
  where work_key = item.work_key;
end
$$;

