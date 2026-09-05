-- Accounting-grade sales expense workflow. Existing rows are preserved and
-- flagged for amount-basis review before they can enter the new approval flow.

insert into public.accounting_cost_categories(
  code, name_th, default_account_code, default_account_name, sort_order
) values
  ('11', 'ค่าใช้จ่ายขายและจัดจำหน่าย', '6200', 'ค่าใช้จ่ายขายและจัดจำหน่าย', 110)
on conflict do nothing;

insert into public.accounting_cost_categories(
  parent_id, code, name_th, default_account_code, default_account_name, sort_order
)
select parent.id, child.code, child.name_th, child.account_code, child.account_name, child.sort_order
from (values
  ('11.01', 'ค่าโฆษณาและประชาสัมพันธ์', '6210', 'ค่าโฆษณาและประชาสัมพันธ์', 1),
  ('11.02', 'ค่านายหน้าและค่าคอมมิชชั่น', '6220', 'ค่านายหน้าและค่าคอมมิชชั่น', 2),
  ('11.03', 'ค่าเดินทางฝ่ายขาย', '6230', 'ค่าเดินทางฝ่ายขาย', 3),
  ('11.04', 'ค่าขนส่งออกและจัดจำหน่าย', '6240', 'ค่าขนส่งออกและจัดจำหน่าย', 4),
  ('11.05', 'ค่ารับรองและนำเสนอลูกค้า', '6250', 'ค่ารับรองและนำเสนอลูกค้า', 5),
  ('11.06', 'ค่าประมูลและเสนอราคา', '6260', 'ค่าประมูลและเสนอราคา', 6),
  ('11.07', 'ค่าวิชาชีพก่อนขาย', '6270', 'ค่าวิชาชีพก่อนขาย', 7),
  ('11.08', 'ค่าตัวอย่างและส่งเสริมการขาย', '6280', 'ค่าตัวอย่างและส่งเสริมการขาย', 8),
  ('11.09', 'ค่าใช้จ่ายขายอื่น', '6290', 'ค่าใช้จ่ายขายอื่น', 9)
) as child(code, name_th, account_code, account_name, sort_order)
join public.accounting_cost_categories parent
  on parent.company_id is null and parent.code = '11'
on conflict do nothing;

alter table public.sales_expenses
  drop constraint if exists sales_expenses_category_check;
alter table public.sales_expenses
  add constraint sales_expenses_category_check check(category in (
    'site_survey', 'travel', 'design', 'estimating', 'sample_mockup',
    'tender_fee', 'presentation', 'commission', 'legal_consulting',
    'advertising', 'sales_promotion', 'delivery_out',
    'customer_entertainment', 'other'
  ));

alter table public.sales_expenses
  drop constraint if exists sales_expenses_status_check;
alter table public.sales_expenses
  add constraint sales_expenses_status_check check(status in (
    'draft', 'pending', 'approved', 'accounting_draft', 'paid',
    'rejected', 'void'
  ));

alter table public.sales_expenses
  add column if not exists cost_category_id uuid references public.accounting_cost_categories(id) on delete restrict,
  add column if not exists account_code text,
  add column if not exists account_name text,
  add column if not exists vendor_id uuid references public.vendors(id) on delete restrict,
  add column if not exists vendor_tax_id text,
  add column if not exists invoice_number text,
  add column if not exists tax_invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists vat_amount numeric(14,2) not null default 0,
  add column if not exists withholding_tax_rate numeric(5,2) not null default 0,
  add column if not exists withholding_tax_amount numeric(14,2) not null default 0,
  add column if not exists settlement_method text not null default 'accounts_payable',
  add column if not exists accounting_document_id uuid references public.accounting_documents(id) on delete restrict,
  add column if not exists employee_advance_case_id uuid references public.employee_advance_cases(id) on delete restrict,
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists accounting_draft_by uuid references public.profiles(id) on delete set null,
  add column if not exists accounting_draft_at timestamptz,
  add column if not exists amount_basis text,
  add column if not exists version integer not null default 1;

update public.sales_expenses
set amount_basis = 'legacy_unverified'
where amount_basis is null;

alter table public.sales_expenses
  alter column amount_basis set default 'before_vat',
  alter column amount_basis set not null;

alter table public.sales_expenses
  drop constraint if exists sales_expenses_tax_rates_check;
alter table public.sales_expenses
  add constraint sales_expenses_tax_rates_check check(
    vat_rate between 0 and 100
    and withholding_tax_rate between 0 and 100
    and vat_amount >= 0
    and withholding_tax_amount >= 0
    and withholding_tax_amount <= actual_amount + vat_amount
  );
alter table public.sales_expenses
  drop constraint if exists sales_expenses_settlement_method_check;
alter table public.sales_expenses
  add constraint sales_expenses_settlement_method_check check(
    settlement_method in ('accounts_payable', 'employee_advance')
  );
alter table public.sales_expenses
  drop constraint if exists sales_expenses_amount_basis_check;
alter table public.sales_expenses
  add constraint sales_expenses_amount_basis_check check(
    amount_basis in ('legacy_unverified', 'before_vat')
  );
alter table public.sales_expenses
  drop constraint if exists sales_expenses_version_check;
alter table public.sales_expenses
  add constraint sales_expenses_version_check check(version > 0);
alter table public.sales_expenses
  drop constraint if exists sales_expenses_advance_method_check;
alter table public.sales_expenses
  add constraint sales_expenses_advance_method_check check(
    settlement_method <> 'employee_advance' or employee_advance_case_id is not null
  );

create unique index if not exists sales_expenses_accounting_document_uq
  on public.sales_expenses(accounting_document_id)
  where accounting_document_id is not null and status <> 'void';
create index if not exists sales_expenses_company_workflow_idx
  on public.sales_expenses(company_id, status, expense_date desc);
create index if not exists sales_expenses_vendor_idx
  on public.sales_expenses(company_id, vendor_id, expense_date desc)
  where vendor_id is not null;

alter table public.accounting_draft_entries
  add column if not exists source_sales_expense_id uuid references public.sales_expenses(id) on delete restrict;
create index if not exists accounting_draft_entries_sales_expense_idx
  on public.accounting_draft_entries(source_sales_expense_id, line_number)
  where source_sales_expense_id is not null;

create table if not exists public.sales_expense_audit (
  id uuid primary key default gen_random_uuid(),
  sales_expense_id uuid not null references public.sales_expenses(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now(),
  unique(company_id, event_key)
);
create index if not exists sales_expense_audit_expense_idx
  on public.sales_expense_audit(sales_expense_id, created_at desc);

alter table public.sales_expense_audit enable row level security;
revoke all on public.sales_expense_audit from anon, authenticated;
grant select on public.sales_expense_audit to authenticated;
drop policy if exists "Company managers read sales expense audit" on public.sales_expense_audit;
create policy "Company managers read sales expense audit"
  on public.sales_expense_audit for select to authenticated
  using((select public.is_company_manager(company_id)));

drop policy if exists "Managers manage sales expenses" on public.sales_expenses;
drop policy if exists "Company managers read sales expenses" on public.sales_expenses;
create policy "Company managers read sales expenses"
  on public.sales_expenses for select to authenticated
  using((select public.is_company_manager(company_id)));
revoke all on public.sales_expenses from anon, authenticated;
grant select on public.sales_expenses to authenticated;

update public.sales_expenses expense
set cost_category_id = category_row.id,
    account_code = category_row.default_account_code,
    account_name = category_row.default_account_name
from public.accounting_cost_categories category_row
where category_row.company_id is null
  and category_row.code = case expense.category
    when 'commission' then '11.02'
    when 'travel' then '11.03'
    when 'presentation' then '11.05'
    when 'customer_entertainment' then '11.05'
    when 'tender_fee' then '11.06'
    when 'site_survey' then '11.07'
    when 'design' then '11.07'
    when 'estimating' then '11.07'
    when 'legal_consulting' then '11.07'
    when 'sample_mockup' then '11.08'
    when 'sales_promotion' then '11.08'
    when 'advertising' then '11.01'
    when 'delivery_out' then '11.04'
    else '11.09'
  end
  and expense.cost_category_id is null;

insert into public.sales_expense_audit(
  sales_expense_id, company_id, event_key, action, before_data, after_data, reason
)
select expense.id, expense.company_id, 'sales-expense-legacy:' || expense.id::text,
  'legacy_snapshot', null, to_jsonb(expense),
  'เก็บ Snapshot รายการเดิมและบังคับตรวจฐานยอดก่อนเข้าสู่ Approval ใหม่'
from public.sales_expenses expense
on conflict(company_id, event_key) do nothing;

create or replace function public.save_sales_expense_draft(
  target_expense_id uuid,
  target_event_key text,
  target_project_id uuid,
  target_expense_date date,
  target_category text,
  target_description text,
  target_budget_amount numeric,
  target_committed_amount numeric,
  target_actual_amount numeric,
  target_cost_category_id uuid,
  target_vendor_id uuid,
  target_vendor_name text,
  target_vendor_tax_id text,
  target_invoice_number text,
  target_tax_invoice_number text,
  target_invoice_date date,
  target_vat_rate numeric,
  target_withholding_tax_rate numeric,
  target_settlement_method text,
  target_accounting_document_id uuid,
  target_employee_advance_case_id uuid,
  target_evidence_reference text,
  target_note text
) returns public.sales_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  company_value uuid;
  before_row public.sales_expenses;
  result public.sales_expenses;
  existing_expense_id uuid;
  category_row public.accounting_cost_categories;
  vendor_row public.vendors;
  document_row public.accounting_documents;
  advance_row public.employee_advance_cases;
  vat_value numeric(14,2);
  withholding_value numeric(14,2);
  action_value text;
begin
  if actor_id is null then raise exception 'authentication_required'; end if;
  if nullif(btrim(coalesce(target_event_key, '')), '') is null then raise exception 'event_key_required'; end if;
  if target_category not in (
    'site_survey', 'travel', 'design', 'estimating', 'sample_mockup',
    'tender_fee', 'presentation', 'commission', 'legal_consulting',
    'advertising', 'sales_promotion', 'delivery_out', 'customer_entertainment', 'other'
  ) then raise exception 'sales_expense_category_invalid'; end if;
  if target_settlement_method not in ('accounts_payable', 'employee_advance') then
    raise exception 'sales_expense_settlement_method_invalid';
  end if;
  if coalesce(target_budget_amount, 0) < 0
    or coalesce(target_committed_amount, 0) < 0
    or coalesce(target_actual_amount, 0) < 0 then
    raise exception 'sales_expense_amount_invalid';
  end if;
  if coalesce(target_vat_rate, 0) not between 0 and 100
    or coalesce(target_withholding_tax_rate, 0) not between 0 and 100 then
    raise exception 'sales_expense_tax_rate_invalid';
  end if;

  select project.company_id into company_value
  from public.projects project
  where project.project_id = target_project_id;
  if company_value is null then raise exception 'sales_expense_project_not_found'; end if;
  if not public.is_company_manager(company_value) then raise exception 'permission_denied'; end if;

  select audit.sales_expense_id into existing_expense_id
  from public.sales_expense_audit audit
  where audit.company_id = company_value and audit.event_key = target_event_key;
  if existing_expense_id is not null then
    select * into result from public.sales_expenses where id = existing_expense_id;
    return result;
  end if;

  select * into category_row
  from public.accounting_cost_categories category
  where category.id = target_cost_category_id
    and category.active
    and category.code like '11.%'
    and (category.company_id is null or category.company_id = company_value);
  if not found or nullif(category_row.default_account_code, '') is null then
    raise exception 'sales_expense_account_category_required';
  end if;

  if target_vendor_id is not null then
    select * into vendor_row from public.vendors vendor
    where vendor.id = target_vendor_id and vendor.company_id = company_value;
    if not found then raise exception 'sales_expense_vendor_scope_invalid'; end if;
  end if;
  if target_accounting_document_id is not null then
    select * into document_row from public.accounting_documents document
    where document.id = target_accounting_document_id and document.company_id = company_value;
    if not found then raise exception 'sales_expense_document_scope_invalid'; end if;
    if document_row.project_id is not null and document_row.project_id <> target_project_id then
      raise exception 'sales_expense_document_project_mismatch';
    end if;
    if target_vendor_id is not null and document_row.vendor_id is not null
      and document_row.vendor_id <> target_vendor_id then
      raise exception 'sales_expense_document_vendor_mismatch';
    end if;
    if exists(
      select 1 from public.sales_expenses expense
      where expense.accounting_document_id = target_accounting_document_id
        and expense.id is distinct from target_expense_id
        and expense.status <> 'void'
    ) then raise exception 'sales_expense_document_already_linked'; end if;
  end if;
  if target_employee_advance_case_id is not null then
    select * into advance_row from public.employee_advance_cases advance_case
    where advance_case.id = target_employee_advance_case_id
      and advance_case.company_id = company_value;
    if not found then raise exception 'sales_expense_advance_scope_invalid'; end if;
    if advance_row.project_id is not null and advance_row.project_id <> target_project_id then
      raise exception 'sales_expense_advance_project_mismatch';
    end if;
  end if;
  if target_settlement_method = 'employee_advance' and target_employee_advance_case_id is null then
    raise exception 'sales_expense_advance_required';
  end if;

  vat_value := round(coalesce(target_actual_amount, 0) * coalesce(target_vat_rate, 0) / 100, 2);
  withholding_value := round(coalesce(target_actual_amount, 0) * coalesce(target_withholding_tax_rate, 0) / 100, 2);
  if vat_value > 0 and nullif(btrim(coalesce(target_tax_invoice_number, '')), '') is null then
    raise exception 'sales_expense_tax_invoice_required_for_vat';
  end if;

  if target_expense_id is null then
    insert into public.sales_expenses(
      company_id, project_id, expense_date, category, description,
      budget_amount, committed_amount, actual_amount, status, outcome_bucket,
      cost_category_id, account_code, account_name, vendor_id, vendor_name, vendor_tax_id,
      invoice_number, tax_invoice_number, invoice_date, vat_rate, vat_amount,
      withholding_tax_rate, withholding_tax_amount, settlement_method,
      accounting_document_id, employee_advance_case_id, evidence_reference, note,
      amount_basis, created_by
    ) values (
      company_value, target_project_id, coalesce(target_expense_date, current_date),
      target_category, btrim(target_description), coalesce(target_budget_amount, 0),
      coalesce(target_committed_amount, 0), coalesce(target_actual_amount, 0),
      'draft', 'pending_result', category_row.id, category_row.default_account_code,
      category_row.default_account_name, target_vendor_id,
      coalesce(nullif(btrim(target_vendor_name), ''), vendor_row.name),
      coalesce(nullif(btrim(target_vendor_tax_id), ''), vendor_row.tax_id),
      nullif(btrim(target_invoice_number), ''), nullif(btrim(target_tax_invoice_number), ''),
      target_invoice_date, coalesce(target_vat_rate, 0), vat_value,
      coalesce(target_withholding_tax_rate, 0), withholding_value, target_settlement_method,
      target_accounting_document_id, target_employee_advance_case_id,
      nullif(btrim(target_evidence_reference), ''), nullif(btrim(target_note), ''),
      'before_vat', actor_id
    ) returning * into result;
    action_value := 'draft_created';
  else
    select * into before_row from public.sales_expenses expense
    where expense.id = target_expense_id for update;
    if not found then raise exception 'sales_expense_not_found'; end if;
    if before_row.company_id <> company_value then raise exception 'sales_expense_company_change_forbidden'; end if;
    if before_row.status not in ('draft', 'rejected') then raise exception 'sales_expense_not_editable'; end if;
    update public.sales_expenses set
      project_id = target_project_id,
      expense_date = coalesce(target_expense_date, current_date),
      category = target_category,
      description = btrim(target_description),
      budget_amount = coalesce(target_budget_amount, 0),
      committed_amount = coalesce(target_committed_amount, 0),
      actual_amount = coalesce(target_actual_amount, 0),
      status = 'draft',
      cost_category_id = category_row.id,
      account_code = category_row.default_account_code,
      account_name = category_row.default_account_name,
      vendor_id = target_vendor_id,
      vendor_name = coalesce(nullif(btrim(target_vendor_name), ''), vendor_row.name),
      vendor_tax_id = coalesce(nullif(btrim(target_vendor_tax_id), ''), vendor_row.tax_id),
      invoice_number = nullif(btrim(target_invoice_number), ''),
      tax_invoice_number = nullif(btrim(target_tax_invoice_number), ''),
      invoice_date = target_invoice_date,
      vat_rate = coalesce(target_vat_rate, 0),
      vat_amount = vat_value,
      withholding_tax_rate = coalesce(target_withholding_tax_rate, 0),
      withholding_tax_amount = withholding_value,
      settlement_method = target_settlement_method,
      accounting_document_id = target_accounting_document_id,
      employee_advance_case_id = target_employee_advance_case_id,
      evidence_reference = nullif(btrim(target_evidence_reference), ''),
      note = nullif(btrim(target_note), ''),
      amount_basis = 'before_vat',
      submitted_by = null,
      submitted_at = null,
      rejected_by = null,
      rejected_at = null,
      rejection_reason = null,
      version = version + 1,
      updated_at = now()
    where id = before_row.id returning * into result;
    action_value := 'draft_updated';
  end if;

  insert into public.sales_expense_audit(
    sales_expense_id, company_id, event_key, action, actor_profile_id,
    before_data, after_data
  ) values (
    result.id, result.company_id, target_event_key, action_value, actor_id,
    case when before_row.id is null then null else to_jsonb(before_row) end,
    to_jsonb(result)
  );
  return result;
end;
$$;

create or replace function public.transition_sales_expense(
  target_expense_id uuid,
  target_action text,
  target_event_key text,
  target_reason text default null
) returns public.sales_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  before_row public.sales_expenses;
  result public.sales_expenses;
  existing_expense_id uuid;
  document_row public.accounting_documents;
  next_line integer := 1;
  credit_account_code text;
  credit_account_name text;
  net_payable numeric(14,2);
begin
  if actor_id is null then raise exception 'authentication_required'; end if;
  if nullif(btrim(coalesce(target_event_key, '')), '') is null then raise exception 'event_key_required'; end if;
  select * into before_row from public.sales_expenses expense
  where expense.id = target_expense_id for update;
  if not found then raise exception 'sales_expense_not_found'; end if;
  if not public.is_company_manager(before_row.company_id) then raise exception 'permission_denied'; end if;

  select audit.sales_expense_id into existing_expense_id
  from public.sales_expense_audit audit
  where audit.company_id = before_row.company_id and audit.event_key = target_event_key;
  if existing_expense_id is not null then
    select * into result from public.sales_expenses where id = existing_expense_id;
    return result;
  end if;

  if target_action = 'submit' then
    if before_row.status not in ('draft', 'rejected') then raise exception 'sales_expense_submit_state_invalid'; end if;
    if before_row.amount_basis <> 'before_vat' then raise exception 'sales_expense_legacy_amount_requires_review'; end if;
    if before_row.actual_amount <= 0
      or length(btrim(before_row.description)) < 3
      or nullif(before_row.account_code, '') is null
      or nullif(before_row.vendor_name, '') is null then
      raise exception 'sales_expense_required_fields_incomplete';
    end if;
    if num_nonnulls(before_row.evidence_reference, before_row.accounting_document_id, before_row.employee_advance_case_id) = 0 then
      raise exception 'sales_expense_evidence_required';
    end if;
    if before_row.vat_amount > 0 and nullif(before_row.tax_invoice_number, '') is null then
      raise exception 'sales_expense_tax_invoice_required_for_vat';
    end if;
    update public.sales_expenses set
      status = 'pending', submitted_by = actor_id, submitted_at = now(),
      rejected_by = null, rejected_at = null, rejection_reason = null,
      version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'approve' then
    if before_row.status <> 'pending' then raise exception 'sales_expense_approve_state_invalid'; end if;
    if before_row.submitted_by = actor_id then raise exception 'sales_expense_maker_checker_required'; end if;
    update public.sales_expenses set
      status = 'approved', approved_by = actor_id, approved_at = now(),
      version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'reject' then
    if before_row.status <> 'pending' then raise exception 'sales_expense_reject_state_invalid'; end if;
    if nullif(btrim(coalesce(target_reason, '')), '') is null then raise exception 'sales_expense_reason_required'; end if;
    update public.sales_expenses set
      status = 'rejected', rejected_by = actor_id, rejected_at = now(),
      rejection_reason = btrim(target_reason), version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'create_accounting_draft' then
    if before_row.status <> 'approved' then raise exception 'sales_expense_accounting_state_invalid'; end if;
    if before_row.accounting_document_id is null then raise exception 'sales_expense_accounting_document_required'; end if;
    select * into document_row from public.accounting_documents document
    where document.id = before_row.accounting_document_id
      and document.company_id = before_row.company_id for update;
    if not found then raise exception 'sales_expense_document_scope_invalid'; end if;
    if document_row.status <> 'confirmed' or document_row.posting_status = 'posted' then
      raise exception 'sales_expense_document_not_ready';
    end if;
    net_payable := round(before_row.actual_amount + before_row.vat_amount - before_row.withholding_tax_amount, 2);
    if document_row.subtotal is not null and abs(document_row.subtotal - before_row.actual_amount) > 1 then
      raise exception 'sales_expense_document_subtotal_mismatch';
    end if;
    if document_row.vat_amount is not null and abs(document_row.vat_amount - before_row.vat_amount) > 1 then
      raise exception 'sales_expense_document_vat_mismatch';
    end if;
    if document_row.withholding_tax_amount is not null
      and abs(document_row.withholding_tax_amount - before_row.withholding_tax_amount) > 1 then
      raise exception 'sales_expense_document_withholding_mismatch';
    end if;
    if document_row.total_amount is not null and abs(document_row.total_amount - net_payable) > 1 then
      raise exception 'sales_expense_document_total_mismatch';
    end if;
    if exists(
      select 1 from public.accounting_draft_entries entry
      where entry.document_id = document_row.id
        and entry.source_sales_expense_id is not null
        and entry.source_sales_expense_id <> before_row.id
    ) then raise exception 'sales_expense_document_has_other_accounting_draft'; end if;

    -- Never replace accounting work implicitly. Existing draft lines require an
    -- accountant to resolve the document before this workflow can create lines.
    if exists(
      select 1 from public.accounting_draft_entries entry
      where entry.document_id = document_row.id
    ) then raise exception 'sales_expense_existing_accounting_draft_requires_review'; end if;
    insert into public.accounting_draft_entries(
      document_id, line_number, account_code, account_name, debit, credit,
      project_id, description, source_sales_expense_id
    ) values (
      document_row.id, next_line, before_row.account_code, before_row.account_name,
      before_row.actual_amount, 0, before_row.project_id, before_row.description, before_row.id
    );
    next_line := next_line + 1;
    if before_row.vat_amount > 0 then
      insert into public.accounting_draft_entries(
        document_id, line_number, account_code, account_name, debit, credit,
        project_id, description, source_sales_expense_id
      ) values (
        document_row.id, next_line, '1150', 'ภาษีซื้อ', before_row.vat_amount, 0,
        before_row.project_id, 'ภาษีซื้อตามใบกำกับภาษี', before_row.id
      );
      next_line := next_line + 1;
    end if;
    if before_row.settlement_method = 'employee_advance' then
      credit_account_code := '1190';
      credit_account_name := 'เงินทดรองพนักงาน';
    else
      credit_account_code := '2100';
      credit_account_name := 'เจ้าหนี้การค้า';
    end if;
    insert into public.accounting_draft_entries(
      document_id, line_number, account_code, account_name, debit, credit,
      project_id, description, source_sales_expense_id
    ) values (
      document_row.id, next_line, credit_account_code, credit_account_name,
      0, net_payable, before_row.project_id,
      coalesce(before_row.vendor_name, 'ผู้รับเงินตามเอกสาร'), before_row.id
    );
    next_line := next_line + 1;
    if before_row.withholding_tax_amount > 0 then
      insert into public.accounting_draft_entries(
        document_id, line_number, account_code, account_name, debit, credit,
        project_id, description, source_sales_expense_id
      ) values (
        document_row.id, next_line, '2150', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',
        0, before_row.withholding_tax_amount, before_row.project_id,
        'ภาษีหัก ณ ที่จ่าย', before_row.id
      );
    end if;
    update public.accounting_documents set posting_status = 'draft', updated_at = now()
    where id = document_row.id;
    update public.sales_expenses set
      status = 'accounting_draft', accounting_draft_by = actor_id,
      accounting_draft_at = now(), version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'void' then
    if before_row.status not in ('draft', 'rejected') then raise exception 'sales_expense_void_state_invalid'; end if;
    if nullif(btrim(coalesce(target_reason, '')), '') is null then raise exception 'sales_expense_reason_required'; end if;
    update public.sales_expenses set
      status = 'void', note = concat_ws(E'\n', nullif(note, ''), 'Void: ' || btrim(target_reason)),
      version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  else
    raise exception 'sales_expense_action_invalid';
  end if;

  insert into public.sales_expense_audit(
    sales_expense_id, company_id, event_key, action, actor_profile_id,
    before_data, after_data, reason
  ) values (
    result.id, result.company_id, target_event_key, target_action, actor_id,
    to_jsonb(before_row), to_jsonb(result), nullif(btrim(target_reason), '')
  );
  return result;
end;
$$;

create or replace function public.classify_sales_expense_outcome(
  target_expense_id uuid,
  target_outcome text,
  target_event_key text,
  target_reason text
) returns public.sales_expenses
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  before_row public.sales_expenses;
  result public.sales_expenses;
  existing_expense_id uuid;
begin
  if actor_id is null then raise exception 'authentication_required'; end if;
  select * into before_row from public.sales_expenses where id = target_expense_id for update;
  if not found then raise exception 'sales_expense_not_found'; end if;
  if not public.is_company_manager(before_row.company_id) then raise exception 'permission_denied'; end if;
  select audit.sales_expense_id into existing_expense_id
  from public.sales_expense_audit audit
  where audit.company_id = before_row.company_id and audit.event_key = target_event_key;
  if existing_expense_id is not null then
    select * into result from public.sales_expenses where id = existing_expense_id;
    return result;
  end if;
  if before_row.status not in ('approved', 'accounting_draft', 'paid') then
    raise exception 'sales_expense_outcome_state_invalid';
  end if;
  if target_outcome not in ('selling_expense', 'lost_bid', 'customer_recoverable') then
    raise exception 'sales_expense_outcome_invalid';
  end if;
  if nullif(btrim(coalesce(target_reason, '')), '') is null then raise exception 'sales_expense_reason_required'; end if;
  update public.sales_expenses set outcome_bucket = target_outcome, version = version + 1, updated_at = now()
  where id = before_row.id returning * into result;
  insert into public.sales_expense_audit(
    sales_expense_id, company_id, event_key, action, actor_profile_id,
    before_data, after_data, reason
  ) values (
    result.id, result.company_id, target_event_key, 'outcome_' || target_outcome,
    actor_id, to_jsonb(before_row), to_jsonb(result), btrim(target_reason)
  );
  return result;
end;
$$;

create or replace function public.transfer_sales_expense_to_project_cost(
  target_expense_id uuid,
  target_cost_code_id uuid,
  target_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  expense public.sales_expenses;
  existing_entry_id uuid;
  entry_id uuid;
  maximum numeric;
begin
  if actor_id is null then raise exception 'authentication_required'; end if;
  select * into expense from public.sales_expenses where id = target_expense_id for update;
  if not found then raise exception 'sales_expense_not_found'; end if;
  if not public.is_company_manager(expense.company_id) then raise exception 'permission_denied'; end if;
  if expense.status not in ('approved', 'accounting_draft', 'paid') then
    raise exception 'sales_expense_project_transfer_state_invalid';
  end if;
  select id into existing_entry_id from public.project_cost_entries
  where source_sales_expense_id = expense.id;
  if existing_entry_id is not null then return existing_entry_id; end if;
  if expense.outcome_bucket = 'lost_bid' then raise exception 'sales_expense_lost_bid_cannot_transfer'; end if;
  if not exists(
    select 1 from public.project_cost_codes cost_code
    where cost_code.id = target_cost_code_id
      and cost_code.company_id = expense.company_id
      and cost_code.active
  ) then raise exception 'sales_expense_cost_code_scope_invalid'; end if;
  maximum := greatest(expense.budget_amount, expense.committed_amount, expense.actual_amount);
  if target_amount <= 0 or target_amount > maximum then raise exception 'sales_expense_transfer_amount_invalid'; end if;
  insert into public.project_cost_entries(
    company_id, project_id, cost_code_id, source_sales_expense_id, cost_date,
    description, actual_amount, forecast_amount, status, created_by
  ) values (
    expense.company_id, expense.project_id, target_cost_code_id, expense.id,
    expense.expense_date, 'โอนจากค่าใช้จ่ายขาย: ' || expense.description,
    target_amount, target_amount, 'approved', actor_id
  ) returning id into entry_id;
  update public.sales_expenses set
    outcome_bucket = 'project_cost', project_transfer_amount = target_amount,
    version = version + 1, updated_at = now()
  where id = expense.id;
  insert into public.sales_expense_audit(
    sales_expense_id, company_id, event_key, action, actor_profile_id,
    before_data, after_data, reason
  ) values (
    expense.id, expense.company_id, 'sales-expense-project-transfer:' || expense.id::text,
    'outcome_project_cost', actor_id, to_jsonb(expense),
    (select to_jsonb(updated) from public.sales_expenses updated where updated.id = expense.id),
    'โอนเป็นต้นทุนโครงการ ' || target_amount::text
  ) on conflict(company_id, event_key) do nothing;
  return entry_id;
end;
$$;

revoke execute on function public.save_sales_expense_draft(
  uuid, text, uuid, date, text, text, numeric, numeric, numeric, uuid, uuid,
  text, text, text, text, date, numeric, numeric, text, uuid, uuid, text, text
) from public, anon;
revoke execute on function public.transition_sales_expense(uuid, text, text, text) from public, anon;
revoke execute on function public.classify_sales_expense_outcome(uuid, text, text, text) from public, anon;
revoke execute on function public.transfer_sales_expense_to_project_cost(uuid, uuid, numeric) from public, anon;
grant execute on function public.save_sales_expense_draft(
  uuid, text, uuid, date, text, text, numeric, numeric, numeric, uuid, uuid,
  text, text, text, text, date, numeric, numeric, text, uuid, uuid, text, text
) to authenticated;
grant execute on function public.transition_sales_expense(uuid, text, text, text) to authenticated;
grant execute on function public.classify_sales_expense_outcome(uuid, text, text, text) to authenticated;
grant execute on function public.transfer_sales_expense_to_project_cost(uuid, uuid, numeric) to authenticated;

comment on table public.sales_expense_audit is
  'Append-only old/new audit for sales expense draft, approval, accounting and outcome decisions.';
comment on column public.sales_expenses.actual_amount is
  'Expense base before VAT for amount_basis=before_vat; legacy rows require review before submit.';
comment on column public.accounting_draft_entries.source_sales_expense_id is
  'Identifies accounting draft lines generated atomically from one approved sales expense.';

notify pgrst, 'reload schema';
