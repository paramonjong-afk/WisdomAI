-- Accounting owns classification and approval. Once an employee advance is
-- approved and assigned to a pay period, HR/Payroll owns the deduction step.
create or replace function public.route_approved_employee_advance_to_hr_payroll(
  target_entry_id uuid,
  target_event_key text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.employee_money_ledger_entries;
  assignment_row public.employee_money_pay_period_assignments;
  flow_before public.document_flow_items;
  flow_after public.document_flow_items;
begin
  if nullif(btrim(target_event_key), '') is null then
    raise exception 'employee_advance_hr_route_event_key_required';
  end if;

  if exists (
    select 1 from public.document_flow_events event
    where event.event_key = target_event_key
  ) then
    return true;
  end if;

  select * into entry_row
  from public.employee_money_ledger_entries entry
  where entry.id = target_entry_id
  for update;

  if entry_row.id is null
    or entry_row.entry_type <> 'advance_issued'
    or entry_row.account_scope <> 'advance'
    or entry_row.entry_status <> 'approved'
    or entry_row.source_flow_item_id is null then
    return false;
  end if;

  select * into assignment_row
  from public.employee_money_pay_period_assignments assignment
  where assignment.ledger_entry_id = entry_row.id;
  if assignment_row.id is null then return false; end if;

  select * into flow_before
  from public.document_flow_items flow
  where flow.id = entry_row.source_flow_item_id
    and flow.company_id = entry_row.company_id
  for update;
  if flow_before.id is null then return false; end if;

  update public.document_flow_destination_tasks task
  set status = 'completed',
      completed_by = coalesce(task.completed_by, entry_row.reviewed_by),
      completed_at = coalesce(task.completed_at, entry_row.reviewed_at, now()),
      note = 'บัญชียืนยันยอดเงินเบิกล่วงหน้าและส่งต่อ HR/Payroll แล้ว',
      version = task.version + 1,
      updated_at = now()
  where task.item_id = flow_before.id
    and task.department = 'accounting'
    and task.status not in ('completed', 'cancelled');

  insert into public.document_flow_destination_tasks(
    item_id, company_id, department, required, status, note
  ) values (
    flow_before.id, flow_before.company_id, 'hr', true, 'queued',
    'ตรวจงวดและนำเงินเบิกล่วงหน้าไปหักใน Payroll ตอนปิดงวด'
  )
  on conflict(item_id, department) do update set
    required = true,
    status = case
      when public.document_flow_destination_tasks.status = 'completed' then 'completed'
      else 'queued'
    end,
    assigned_to = case
      when public.document_flow_destination_tasks.status = 'completed'
        then public.document_flow_destination_tasks.assigned_to
      else null
    end,
    note = excluded.note,
    completed_at = case
      when public.document_flow_destination_tasks.status = 'completed'
        then public.document_flow_destination_tasks.completed_at
      else null
    end,
    completed_by = case
      when public.document_flow_destination_tasks.status = 'completed'
        then public.document_flow_destination_tasks.completed_by
      else null
    end,
    version = public.document_flow_destination_tasks.version + 1,
    updated_at = now();

  update public.document_flow_items flow
  set current_flow = 'posting',
      current_room = 'hr_payroll_advance_queue',
      state = 'destination_in_progress',
      target_department = 'hr',
      candidate_departments = array(
        select distinct department
        from unnest(coalesce(flow.candidate_departments, '{}'::text[]) || array['accounting', 'hr']) department
      ),
      assignment_status = 'unassigned',
      assigned_to = null,
      sensitivity = 'restricted_hr',
      classification_note = 'บัญชียืนยันแล้ว · รอ HR/Payroll หักเงินเบิกล่วงหน้าในงวดที่ผูกไว้',
      version = flow.version + 1,
      updated_at = now()
  where flow.id = flow_before.id
  returning * into flow_after;

  update public.transfer_slip_money_lineages lineage
  set route_status = 'routed',
      next_destination = 'payroll',
      route_note = concat_ws(' · ', nullif(btrim(lineage.route_note), ''),
        'บัญชียืนยันเงินเบิกล่วงหน้าแล้ว ส่งต่อ HR/Payroll ตามงวด'),
      version = lineage.version + 1,
      updated_at = now()
  where lineage.item_id = flow_before.id
    and (entry_row.financial_transaction_id is null
      or lineage.transaction_id = entry_row.financial_transaction_id);

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type,
    from_flow, to_flow, from_state, to_state, from_room, to_room,
    note, payload, actor_id
  ) values (
    flow_before.id, flow_before.company_id, target_event_key,
    'employee_advance_routed_to_hr_payroll',
    flow_before.current_flow, flow_after.current_flow,
    flow_before.state, flow_after.state,
    flow_before.current_room, flow_after.current_room,
    'บัญชียืนยันยอดและผูกงวดแล้ว ส่งงานต่อ HR/Payroll โดยใช้สลิปและ Ledger เดิม',
    jsonb_build_object(
      'ledger_entry_id', entry_row.id,
      'pay_period_assignment_id', assignment_row.id,
      'pay_period_id', assignment_row.pay_period_id,
      'from_department', flow_before.target_department,
      'to_department', 'hr',
      'next_destination', 'payroll'
    ),
    entry_row.reviewed_by
  );

  insert into public.employee_money_ledger_audit(
    company_id, entry_id, event_key, action, actor_profile_id,
    before_data, after_data, reason
  ) values (
    entry_row.company_id, entry_row.id,
    'ledger-audit:' || target_event_key,
    'routed_to_hr_payroll', entry_row.reviewed_by,
    jsonb_build_object(
      'current_room', flow_before.current_room,
      'target_department', flow_before.target_department
    ),
    jsonb_build_object(
      'current_room', flow_after.current_room,
      'target_department', flow_after.target_department,
      'pay_period_id', assignment_row.pay_period_id,
      'next_destination', 'payroll'
    ),
    'บัญชียืนยันยอดเงินเบิกล่วงหน้าแล้ว ส่งต่อ HR/Payroll เพื่อหักตอนปิดงวด'
  ) on conflict(company_id, event_key) do nothing;

  return true;
end;
$$;

revoke all on function public.route_approved_employee_advance_to_hr_payroll(uuid, text)
  from public, anon, authenticated;

create or replace function public.route_approved_employee_advance_to_hr_payroll_from_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.route_approved_employee_advance_to_hr_payroll(
    new.id,
    'employee-advance:hr-payroll:' || new.id::text
  );
  return new;
end;
$$;

revoke all on function public.route_approved_employee_advance_to_hr_payroll_from_entry()
  from public, anon, authenticated;

drop trigger if exists route_approved_employee_advance_to_hr_payroll_after_entry
  on public.employee_money_ledger_entries;
create trigger route_approved_employee_advance_to_hr_payroll_after_entry
after insert or update of entry_status, entry_type, account_scope, source_flow_item_id
on public.employee_money_ledger_entries
for each row execute function public.route_approved_employee_advance_to_hr_payroll_from_entry();

create or replace function public.route_approved_employee_advance_to_hr_payroll_from_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.route_approved_employee_advance_to_hr_payroll(
    new.ledger_entry_id,
    'employee-advance:hr-payroll:' || new.ledger_entry_id::text
  );
  return new;
end;
$$;

revoke all on function public.route_approved_employee_advance_to_hr_payroll_from_period()
  from public, anon, authenticated;

drop trigger if exists route_approved_employee_advance_to_hr_payroll_after_period
  on public.employee_money_pay_period_assignments;
create trigger route_approved_employee_advance_to_hr_payroll_after_period
after insert or update of pay_period_id
on public.employee_money_pay_period_assignments
for each row execute function public.route_approved_employee_advance_to_hr_payroll_from_period();

select public.route_approved_employee_advance_to_hr_payroll(
  entry.id,
  'employee-advance:hr-payroll:' || entry.id::text
)
from public.employee_money_ledger_entries entry
where entry.entry_type = 'advance_issued'
  and entry.account_scope = 'advance'
  and entry.entry_status = 'approved'
  and entry.source_flow_item_id is not null
  and exists (
    select 1 from public.employee_money_pay_period_assignments assignment
    where assignment.ledger_entry_id = entry.id
  );

comment on function public.route_approved_employee_advance_to_hr_payroll(uuid, text) is
  'Internal idempotent handoff: approved employee advances move from Accounting to the HR/Payroll pay-period queue without duplicating financial data.';

notify pgrst, 'reload schema';
