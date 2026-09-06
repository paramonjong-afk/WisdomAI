-- Control-fund transfers move custody of money; they are not expense evidence.
-- Keep raw slips/OCR immutable and remove only the incorrect derived account link.
create or replace function public.validate_transfer_slip_allocation_account()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_id uuid;
  category_row public.accounting_cost_categories;
  account_required boolean;
begin
  account_required := new.status = 'confirmed'
    and new.purpose_type in ('payroll','materials','project_expense','general_expense','vendor_payment','subcontractor','travel','bank_fee','tax');

  if new.purpose_type not in ('payroll','materials','project_expense','general_expense','vendor_payment','subcontractor','travel','bank_fee','tax') then
    new.cost_category_id := null;
    new.account_code := null;
    new.account_name := null;
    new.evidence := (
      select coalesce(jsonb_agg(evidence_item), '[]'::jsonb)
      from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
      where evidence_item->>'field' not in ('cost_category_id','account_code','account_name')
    );
    return new;
  end if;

  category_id := nullif(
    coalesce(
      new.cost_category_id::text,
      (select evidence_item->>'value'
       from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
       where evidence_item->>'field' = 'cost_category_id'
       limit 1)
    ),
    ''
  )::uuid;

  if category_id is null then
    new.cost_category_id := null;
    new.account_code := null;
    new.account_name := null;
    if account_required then raise exception 'money_allocation_account_required:%', new.sequence; end if;
    return new;
  end if;

  select * into category_row
  from public.accounting_cost_categories category
  where category.id = category_id
    and category.active
    and (category.company_id is null or category.company_id = new.company_id);

  if category_row.id is null
    or nullif(btrim(category_row.default_account_code), '') is null
    or nullif(btrim(category_row.default_account_name), '') is null
  then
    raise exception 'money_allocation_account_invalid:%', new.sequence;
  end if;

  new.cost_category_id := category_row.id;
  new.account_code := category_row.default_account_code;
  new.account_name := category_row.default_account_name;
  return new;
end;
$$;

insert into public.document_flow_events(
  item_id, company_id, event_key, event_type, from_flow, to_flow,
  from_state, to_state, from_room, to_room, note, payload
)
select
  lineage.item_id,
  allocation.company_id,
  'control-fund-expense-account-cleared:' || allocation.id::text,
  'control_fund_expense_account_cleared',
  item.current_flow,
  item.current_flow,
  item.state,
  item.state,
  item.current_room,
  item.current_room,
  'ล้างบัญชีค่าใช้จ่ายที่ผูกผิดจากเงินคุมยอด โดยไม่แก้ Raw/OCR/สลิปต้นฉบับ',
  jsonb_build_object(
    'allocation_id', allocation.id,
    'purpose_type', allocation.purpose_type,
    'old_cost_category_id', allocation.cost_category_id,
    'old_account_code', allocation.account_code,
    'old_account_name', allocation.account_name,
    'correction_rule', 'control_fund_is_not_expense'
  )
from public.transfer_slip_money_allocations allocation
join public.transfer_slip_money_lineages lineage on lineage.id = allocation.lineage_id
join public.document_flow_items item on item.id = lineage.item_id
where allocation.purpose_type not in ('payroll','materials','project_expense','general_expense','vendor_payment','subcontractor','travel','bank_fee','tax')
  and allocation.status not in ('superseded','cancelled')
  and (allocation.cost_category_id is not null or allocation.account_code is not null or allocation.account_name is not null)
on conflict(event_key) do nothing;

update public.transfer_slip_money_allocations
set cost_category_id = null,
    account_code = null,
    account_name = null,
    evidence = coalesce((
      select jsonb_agg(evidence_item)
      from jsonb_array_elements(coalesce(evidence, '[]'::jsonb)) evidence_item
      where evidence_item->>'field' not in ('cost_category_id','account_code','account_name')
    ), '[]'::jsonb),
    updated_at = now()
where purpose_type not in ('payroll','materials','project_expense','general_expense','vendor_payment','subcontractor','travel','bank_fee','tax')
  and status not in ('superseded','cancelled')
  and (cost_category_id is not null or account_code is not null or account_name is not null);

notify pgrst, 'reload schema';
