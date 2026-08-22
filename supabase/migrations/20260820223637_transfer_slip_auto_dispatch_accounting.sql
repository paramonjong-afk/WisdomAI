-- After Intake quality gates have admitted a transfer slip into Filter, send it
-- straight to Accounting's destination queue.  The task is still a normal
-- central destination task, so Accounting can claim, complete, or return it.

create or replace function public.auto_dispatch_transfer_slip_to_accounting(
  target_source_message_id uuid,
  target_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  before_row public.document_flow_items;
  result_row public.document_flow_items;
begin
  select * into before_row
  from public.document_flow_items
  where source_message_id = target_source_message_id
  for update;

  -- Only dispatch items that have passed Intake and were auto-classified as a
  -- transfer slip.  Corrections, duplicates, rejected items and human-routed
  -- work remain in their current room.
  if before_row.id is null
    or before_row.current_flow <> 'filter'
    or before_row.state <> 'validating'
    or before_row.document_type <> 'transfer_slip'
    or before_row.route_target <> 'payment_verification'
    or before_row.current_room <> 'filter_payment_verification'
  then
    return;
  end if;

  insert into public.document_flow_destination_tasks(
    item_id, company_id, department, required, status, note
  ) values (
    before_row.id, before_row.company_id, 'accounting', true, 'queued',
    'ระบบส่งสลิปโอนเงินเข้าห้องบัญชีอัตโนมัติ'
  ) on conflict (item_id, department) do nothing;

  update public.document_flow_items
  set current_flow = 'posting',
      state = 'destination_in_progress',
      current_room = 'destination_accounting_queue',
      target_department = 'accounting',
      candidate_departments = array['accounting']::text[],
      assignment_status = 'unassigned',
      sensitivity = 'financial',
      classification_note = coalesce(classification_note, 'ระบบส่งสลิปโอนเงินเข้าห้องบัญชีอัตโนมัติ'),
      version = version + 1,
      updated_at = now()
  where id = before_row.id
  returning * into result_row;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type,
    from_flow, to_flow, from_state, to_state, from_room, to_room,
    note, payload, actor_id
  ) values (
    result_row.id, result_row.company_id,
    'transfer-slip-auto-dispatch:' || result_row.id::text || ':' || result_row.version::text,
    'transfer_slip_auto_dispatched',
    before_row.current_flow, result_row.current_flow,
    before_row.state, result_row.state,
    before_row.current_room, result_row.current_room,
    'สลิปโอนเงินผ่าน Intake แล้ว ระบบส่งงานเข้าห้องบัญชีอัตโนมัติ',
    jsonb_build_object('department', 'accounting', 'task_status', 'queued', 'source_message_id', target_source_message_id),
    target_actor_id
  ) on conflict (event_key) do nothing;
end;
$$;

create or replace function public.auto_dispatch_transfer_slip_from_flow_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_dispatch_transfer_slip_to_accounting(new.source_message_id, null);
  return new;
end;
$$;

drop trigger if exists auto_dispatch_transfer_slip_from_flow on public.document_flow_items;
create trigger auto_dispatch_transfer_slip_from_flow
after insert or update of source_message_id, current_flow, state, document_type, route_target, current_room
on public.document_flow_items
for each row execute function public.auto_dispatch_transfer_slip_from_flow_trigger();

-- Dispatch all existing qualifying transfer slips with the same rule.
do $$
declare source_id uuid;
begin
  for source_id in
    select source_message_id from public.document_flow_items
    where current_flow = 'filter'
      and state = 'validating'
      and document_type = 'transfer_slip'
      and route_target = 'payment_verification'
      and current_room = 'filter_payment_verification'
  loop
    perform public.auto_dispatch_transfer_slip_to_accounting(source_id, null);
  end loop;
end;
$$;

revoke all on function public.auto_dispatch_transfer_slip_to_accounting(uuid,uuid),
  public.auto_dispatch_transfer_slip_from_flow_trigger() from public, anon, authenticated;

notify pgrst, 'reload schema';
