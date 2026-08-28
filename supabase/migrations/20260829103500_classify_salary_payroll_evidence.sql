-- Preserve payroll as the HR module while distinguishing salary from worker wages.
-- This correction is scoped to the user-confirmed 30,000 THB source record.
do $$
declare
  target_allocation_id constant uuid := '235ebb3b-1230-479e-a75a-c988cfcb8b45';
  target_item_id constant uuid := 'ca2382ba-20d9-47fe-bcc8-0ee7e60c90f6';
  allocation_row public.transfer_slip_money_allocations;
  item_row public.document_flow_items;
begin
  select * into allocation_row
  from public.transfer_slip_money_allocations
  where id = target_allocation_id
  for update;

  if allocation_row.id is null then
    raise exception 'confirmed_salary_allocation_not_found';
  end if;
  if allocation_row.purpose_type <> 'payroll' or allocation_row.allocation_amount <> 30000 then
    raise exception 'confirmed_salary_allocation_scope_mismatch';
  end if;

  select * into item_row from public.document_flow_items where id = target_item_id;
  if item_row.id is null or allocation_row.lineage_id not in (
    select id from public.transfer_slip_money_lineages where item_id = target_item_id
  ) then
    raise exception 'confirmed_salary_source_mismatch';
  end if;

  if not coalesce(allocation_row.evidence, '[]'::jsonb) @> '[{"field":"payroll_kind","value":"salary"}]'::jsonb then
    update public.transfer_slip_money_allocations
    set evidence = coalesce(evidence, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'field', 'payroll_kind', 'value', 'salary', 'source', 'admin_confirmed'
        )),
        description = coalesce(nullif(description, ''), 'เงินเดือน'),
        version = version + 1,
        updated_at = now()
    where id = target_allocation_id;
  end if;

  insert into public.document_flow_events(
    item_id, company_id, event_key, event_type, from_flow, to_flow,
    from_state, to_state, from_room, to_room, note, payload, actor_id
  ) values (
    item_row.id, item_row.company_id,
    'classify-payroll-salary:' || target_allocation_id::text,
    'transfer_slip_payroll_kind_confirmed',
    item_row.current_flow, item_row.current_flow, item_row.state, item_row.state,
    item_row.current_room, item_row.current_room,
    'Admin ยืนยันว่าเป็นเงินเดือน ไม่ใช่ค่าแรงช่าง',
    jsonb_build_object(
      'allocation_id', target_allocation_id,
      'purpose_type', 'payroll',
      'payroll_kind', 'salary',
      'amount', 30000,
      'source_preserved', true
    ),
    null
  ) on conflict(event_key) do nothing;
end;
$$;
