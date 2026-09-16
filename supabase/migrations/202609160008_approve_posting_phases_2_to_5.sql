-- Record Jong's batch approval for Posting phases 2-5 while enforcing phase gates.
-- Only Phase 2 becomes claimable. Later phases remain blocked on their recorded dependencies.
-- The FILTER backlog originated as live control-plane data. Seed the three approved
-- items only when a clean migration replay does not have them; Production rows win.
insert into public.system_work_items (
  work_key, title, category, status, progress, risk, detail, production_status,
  current_step, context_manifest
)
values
  (
    'FILTER-004', 'Filter: Duplicate และ Document Matching', 'operations', 'ready', 0, 'critical',
    'ตรวจ file hash, perceptual hash และ business key; จัดทำ matching ledger และ duplicate decision states',
    'backlog_registered', 'Define matching ledger and duplicate decision states.',
    jsonb_build_object(
      'controller_plan', 'CTRL-READY-SEQUENCE-20260916', 'execution_phase', 5,
      'depends_on', '["POSTING-FLOW-001"]'::jsonb,
      'approval_gate', 'explicit_policy_approval_required',
      'next_management_action', 'Define matching ledger and duplicate decision states.'
    )
  ),
  (
    'FILTER-007', 'Filter: Approval UX', 'operations', 'ready', 0, 'critical',
    'สร้าง Approval UX หลัง approval snapshot และ concurrency rules พร้อมใช้งาน',
    'backlog_registered', 'Build Approval UX after snapshot/concurrency rules.',
    jsonb_build_object(
      'controller_plan', 'CTRL-READY-SEQUENCE-20260916', 'execution_phase', 5,
      'depends_on', '["POSTING-001","POSTING-002"]'::jsonb,
      'approval_gate', 'explicit_policy_approval_required',
      'next_management_action', 'Build Approval UX after snapshot/concurrency rules.'
    )
  ),
  (
    'FILTER-008', 'Filter: Command, Audit และ Monitoring Integration', 'operations', 'ready', 0, 'critical',
    'เชื่อม command, audit และ monitoring หลัง gateway และ reversal contract ผ่าน gate',
    'backlog_registered', 'Integrate commands, audit and monitoring after gateway/reversal contracts.',
    jsonb_build_object(
      'controller_plan', 'CTRL-READY-SEQUENCE-20260916', 'execution_phase', 5,
      'depends_on', '["POSTING-004","POSTING-005","POSTING-008"]'::jsonb,
      'approval_gate', 'explicit_policy_approval_required',
      'next_management_action', 'Integrate commands, audit and monitoring after gateway/reversal contracts.'
    )
  )
on conflict (work_key) do nothing;

do $$
declare
  item public.system_work_items;
  target record;
  current_fingerprint text;
  approval_reason constant text :=
    'Jong approved Posting phases 2-5 as one controlled batch on 2026-09-16. Execute in dependency order; each phase must pass verification before the next phase is released.';
begin
  select * into item
  from public.system_work_items
  where work_key = 'POSTING-FLOW-001'
  for update;

  if item.work_key is null
     or item.worker_id is not null
     or item.approval_status <> 'approved'
     or item.context_manifest ->> 'approval_receipt' <> 'CTRL-POSTING-FLOW-001-PHASE1-20260916'
     or not (
       (
         item.status = 'review'
         and item.progress = 20
         and item.worker_outcome = 'completed'
         and item.current_step = 'phase1_complete_waiting_phase2_approval'
       )
       or (
         item.status = 'ready'
         and item.progress = 0
         and item.production_status = 'approved_for_execution'
         and item.current_step = 'Phase 1 approved; waiting for an atomic Worker claim.'
       )
     ) then
    raise exception 'Phase 1 completion evidence changed; batch activation refused';
  end if;

  update public.system_work_items
  set status = 'done',
      progress = 100,
      production_status = 'phase1_contract_verified_production',
      current_step = 'Phase 1 contract complete; Phase 2 released by batch approval.',
      control_state = 'done',
      context_manifest = context_manifest || jsonb_build_object(
        'phases_2_to_5', 'approved_with_dependency_gates',
        'batch_approval_receipt', 'CTRL-POSTING-PHASE2-5-20260916',
        'production_revision', '88b342f'
      ),
      evidence = left(concat_ws(E'\n', nullif(evidence, ''),
        'Phase 1 verified on GitHub main and Cloudflare revision 88b342f; batch approval received for Phases 2-5.'), 4000),
      updated_at = now()
  where work_key = 'POSTING-FLOW-001';

  for target in
    select * from (values
      ('POSTING-001', 2, 'Define approval snapshot and transaction preview.'),
      ('POSTING-002', 2, 'Define role, amount and approval-order policy matrix.'),
      ('POSTING-004', 3, 'Define the Accounting/AP gateway command.'),
      ('POSTING-005', 3, 'Define the Stock gateway command.'),
      ('POSTING-008', 4, 'Define correction, compensation and reversal matrix.'),
      ('FILTER-004', 5, 'Define matching ledger and duplicate decision states.'),
      ('FILTER-007', 5, 'Build Approval UX after snapshot/concurrency rules.'),
      ('FILTER-008', 5, 'Integrate commands, audit and monitoring after gateway/reversal contracts.')
    ) as planned(work_key, phase, expected_step)
  loop
    select * into item
    from public.system_work_items as wi
    where wi.work_key = target.work_key
    for update;

    if item.work_key is null
       or item.status <> 'ready'
       or item.progress <> 0
       or item.worker_id is not null
       or item.approval_status <> 'pending'
       or item.production_status <> 'backlog_registered'
       or item.context_manifest ->> 'controller_plan' <> 'CTRL-READY-SEQUENCE-20260916'
       or (item.context_manifest ->> 'execution_phase')::integer <> target.phase
       or item.current_step <> target.expected_step then
      raise exception '% scope/state changed; batch approval refused', target.work_key;
    end if;

    current_fingerprint := public.system_work_item_scope_fingerprint(
      item.work_key, item.title, item.category, item.risk, item.detail
    );

    update public.system_work_item_approvals
    set status = 'approved', decision_channel = 'system', decision_reason = approval_reason,
        decided_at = now(), updated_at = now()
    where work_key = item.work_key and status = 'pending';

    if not found then
      insert into public.system_work_item_approvals(
        work_key, company_id, status, decision_channel, decision_reason, decided_at
      ) values (item.work_key, item.company_id, 'approved', 'system', approval_reason, now());
    end if;

    update public.system_work_items
    set status = case when target.phase = 2 then 'ready' else 'blocked' end,
        production_status = case when target.phase = 2 then 'approved_for_execution' else 'approved_waiting_dependency' end,
        approval_status = 'approved',
        approval_scope = 'Posting controlled batch Phase ' || target.phase || ': ' || target.expected_step,
        approval_fingerprint = current_fingerprint,
        approved_at = now(),
        approval_channel = 'explicit_user_batch_approval_controller_00',
        current_step = case when target.phase = 2
          then 'Batch approved; Phase 2 ready for atomic Worker claim.'
          else 'Batch approved; waiting for prior-phase verification.' end,
        control_state = case when target.phase = 2 then 'queued' else 'blocked' end,
        blocked_since = case when target.phase = 2 then null else now() end,
        context_manifest = context_manifest || jsonb_build_object(
          'batch_approval_receipt', 'CTRL-POSTING-PHASE2-5-20260916',
          'batch_approved_at', now(),
          'phase_gate', case when target.phase = 2 then 'released' else 'waiting_dependency' end
        ),
        evidence = left(concat_ws(E'\n', nullif(evidence, ''), approval_reason), 4000),
        updated_at = now()
    where work_key = item.work_key;
  end loop;
end
$$;
