-- Transfer-slip allocations reuse accounting_cost_categories as the only
-- selectable account source. Raw slip/OCR evidence remains immutable.
alter table public.transfer_slip_money_allocations
  add column if not exists cost_category_id uuid references public.accounting_cost_categories(id) on delete restrict,
  add column if not exists account_code text,
  add column if not exists account_name text;

create index if not exists transfer_slip_money_allocations_cost_category_idx
  on public.transfer_slip_money_allocations(company_id, cost_category_id)
  where cost_category_id is not null and status not in ('superseded', 'cancelled');

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

  account_required := new.status = 'confirmed'
    and new.purpose_type in ('payroll','materials','project_expense','general_expense','vendor_payment','subcontractor','travel','bank_fee','tax');

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

drop trigger if exists validate_transfer_slip_allocation_account on public.transfer_slip_money_allocations;
create trigger validate_transfer_slip_allocation_account
before insert or update of cost_category_id, evidence, status, purpose_type
on public.transfer_slip_money_allocations
for each row execute function public.validate_transfer_slip_allocation_account();

comment on column public.transfer_slip_money_allocations.cost_category_id is
  'Canonical selection from accounting_cost_categories; never inferred from free text.';
comment on column public.transfer_slip_money_allocations.account_code is
  'Snapshot of the selected canonical category account code for audit history.';
comment on column public.transfer_slip_money_allocations.account_name is
  'Snapshot of the selected canonical category account name for audit history.';

notify pgrst, 'reload schema';
