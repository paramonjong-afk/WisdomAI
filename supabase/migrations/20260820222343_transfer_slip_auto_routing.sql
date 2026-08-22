-- Transfer slips are financial evidence.  Once the Intake quality gate has
-- admitted them to Filter, they must enter payment verification for Accounting
-- without creating a second Intake ID or destination task.

create or replace function public.auto_route_transfer_slip_flow(
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
  if not exists (
    select 1 from public.financial_transactions
    where source_message_id = target_source_message_id
      and review_status <> 'dismissed'
  ) then
    return;
  end if;

  select * into before_row
  from public.document_flow_items
  where source_message_id = target_source_message_id
  for update;

  -- Do not bypass quality controls, a correction request, posting, or a
  -- human decision.  Auto-route only the normal Filter queue state.
  if before_row.id is null
    or before_row.current_flow <> 'filter'
    or before_row.state <> 'validating'
    or (
      before_row.document_type = 'transfer_slip'
      and before_row.route_target = 'payment_verification'
      and before_row.current_room = 'filter_payment_verification'
      and before_row.target_department = 'accounting'
    ) then
    return;
  end if;

  update public.document_flow_items
  set document_type = 'transfer_slip',
      route_target = 'payment_verification',
      current_room = 'filter_payment_verification',
      target_department = 'accounting',
      candidate_departments = array['accounting']::text[],
      assignment_status = 'unassigned',
      sensitivity = 'financial',
      auto_routed = true,
      classification_note = coalesce(classification_note, 'ระบบจัดเส้นทางอัตโนมัติจากประเภทสลิปโอนเงิน'),
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
    'transfer-slip-auto-route:' || result_row.id::text || ':' || result_row.version::text,
    'transfer_slip_auto_routed',
    before_row.current_flow, result_row.current_flow,
    before_row.state, result_row.state,
    before_row.current_room, result_row.current_room,
    'ตรวจพบสลิปโอนเงิน จัดเข้าคิวตรวจสอบการโอนของแผนกบัญชีอัตโนมัติ',
    jsonb_build_object('route_target', 'payment_verification', 'target_department', 'accounting', 'source_message_id', target_source_message_id),
    target_actor_id
  ) on conflict (event_key) do nothing;
end;
$$;

create or replace function public.auto_route_transfer_slip_from_financial_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_route_transfer_slip_flow(new.source_message_id, null);
  return new;
end;
$$;

create or replace function public.auto_route_transfer_slip_from_flow_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.auto_route_transfer_slip_flow(new.source_message_id, null);
  return new;
end;
$$;

drop trigger if exists auto_route_transfer_slip_from_financial on public.financial_transactions;
create trigger auto_route_transfer_slip_from_financial
after insert or update of source_message_id, review_status on public.financial_transactions
for each row execute function public.auto_route_transfer_slip_from_financial_trigger();

drop trigger if exists auto_route_transfer_slip_from_flow on public.document_flow_items;
create trigger auto_route_transfer_slip_from_flow
after insert or update of source_message_id, current_flow, state, document_type, route_target, current_room
on public.document_flow_items
for each row execute function public.auto_route_transfer_slip_from_flow_trigger();

-- Repair previously classified transfer slips through the same central rule.
do $$
declare source_id uuid;
begin
  for source_id in
    select source_message_id from public.financial_transactions
    where review_status <> 'dismissed'
  loop
    perform public.auto_route_transfer_slip_flow(source_id, null);
  end loop;
end;
$$;

revoke all on function public.auto_route_transfer_slip_flow(uuid,uuid),
  public.auto_route_transfer_slip_from_financial_trigger(),
  public.auto_route_transfer_slip_from_flow_trigger() from public, anon, authenticated;

notify pgrst, 'reload schema';
