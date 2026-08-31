begin;

insert into public.profiles(id, full_name, email, role) values
  ('10000000-0000-4000-8000-000000000001', 'Sales Expense Maker', 'maker@example.test', 'manager'),
  ('10000000-0000-4000-8000-000000000002', 'Sales Expense Checker', 'checker@example.test', 'manager');

insert into public.companies(id, name, slug) values
  ('20000000-0000-4000-8000-000000000001', 'WisdomAI Runtime Test', 'wisdomai-runtime-test');

insert into public.company_members(company_id, profile_id, company_role) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'manager'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'manager');

insert into public.projects(project_id, id, company_id, name, code) values
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Sales Opportunity Test', 'SALE-TEST');

insert into public.vendors(id, company_id, name, tax_id) values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Advertising Vendor Test', '0100000000001');

insert into public.accounting_documents(
  id, company_id, project_id, vendor_id, document_number, document_date,
  vendor_name, vendor_tax_id, subtotal, vat_amount, withholding_tax_amount,
  total_amount, status, posting_status
) values (
  '50000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'TAX-INV-TEST-001', current_date,
  'Advertising Vendor Test', '0100000000001',
  10000, 700, 200, 10500, 'confirmed', 'draft'
);

insert into public.project_cost_codes(id, company_id, code, name_th) values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10', 'บริหารโครงการและต้นทุนก่อนเริ่มงาน');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

create temporary table runtime_sales_expense(expense_id uuid primary key);
insert into runtime_sales_expense(expense_id)
select (public.save_sales_expense_draft(
  null,
  'sales-expense-runtime:create',
  '30000000-0000-4000-8000-000000000001',
  current_date,
  'advertising',
  'ค่าโฆษณาสำหรับทดสอบ Runtime',
  10000,
  10000,
  10000,
  (select id from public.accounting_cost_categories where company_id is null and code = '11.01'),
  '40000000-0000-4000-8000-000000000001',
  'Advertising Vendor Test',
  '0100000000001',
  'INV-TEST-001',
  'TAX-INV-TEST-001',
  current_date,
  7,
  2,
  'accounts_payable',
  '50000000-0000-4000-8000-000000000001',
  null,
  'ACCOUNTING-DOCUMENT:50000000-0000-4000-8000-000000000001',
  'PostgreSQL isolated runtime smoke'
)).id;

do $$
declare first_id uuid;
declare repeated_id uuid;
begin
  select expense_id into first_id from runtime_sales_expense;
  select (public.save_sales_expense_draft(
    null,
    'sales-expense-runtime:create',
    '30000000-0000-4000-8000-000000000001',
    current_date,
    'advertising',
    'ค่าโฆษณาสำหรับทดสอบ Runtime',
    10000, 10000, 10000,
    (select id from public.accounting_cost_categories where company_id is null and code = '11.01'),
    '40000000-0000-4000-8000-000000000001',
    'Advertising Vendor Test', '0100000000001', 'INV-TEST-001', 'TAX-INV-TEST-001',
    current_date, 7, 2, 'accounts_payable',
    '50000000-0000-4000-8000-000000000001', null,
    'ACCOUNTING-DOCUMENT:50000000-0000-4000-8000-000000000001',
    'PostgreSQL isolated runtime smoke'
  )).id into repeated_id;
  if repeated_id <> first_id then raise exception 'runtime_idempotency_failed'; end if;
  if (select count(*) from public.sales_expenses) <> 1 then raise exception 'runtime_duplicate_expense_created'; end if;
  if (select count(*) from public.sales_expense_audit where event_key = 'sales-expense-runtime:create') <> 1 then
    raise exception 'runtime_duplicate_audit_created';
  end if;
end;
$$;

select public.transition_sales_expense(
  (select expense_id from runtime_sales_expense),
  'submit',
  'sales-expense-runtime:submit',
  'หลักฐานพร้อมตรวจ'
);

do $$
declare maker_was_blocked boolean := false;
begin
  begin
    perform public.transition_sales_expense(
      (select expense_id from runtime_sales_expense),
      'approve',
      'sales-expense-runtime:maker-approve',
      'Maker must not approve'
    );
  exception when others then
    if sqlerrm = 'sales_expense_maker_checker_required' then
      maker_was_blocked := true;
    else
      raise;
    end if;
  end;
  if not maker_was_blocked then raise exception 'runtime_maker_checker_failed'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);

select public.transition_sales_expense(
  (select expense_id from runtime_sales_expense),
  'approve',
  'sales-expense-runtime:checker-approve',
  'Checker reviewed evidence and tax amounts'
);

insert into public.accounting_draft_entries(
  document_id, line_number, account_code, account_name, debit, credit, project_id, description
) values
  ('50000000-0000-4000-8000-000000000001', 1, '5200', 'Generic expense', 10700, 0, '30000000-0000-4000-8000-000000000001', 'Generic draft before classification'),
  ('50000000-0000-4000-8000-000000000001', 2, '2100', 'Accounts payable', 0, 10500, '30000000-0000-4000-8000-000000000001', 'Generic AP'),
  ('50000000-0000-4000-8000-000000000001', 3, '2150', 'Withholding payable', 0, 200, '30000000-0000-4000-8000-000000000001', 'Generic WHT');

select public.transition_sales_expense(
  (select expense_id from runtime_sales_expense),
  'create_accounting_draft',
  'sales-expense-runtime:accounting-draft',
  'Create balanced draft after approval'
);

do $$
declare target_id uuid;
declare debit_total numeric(14,2);
declare credit_total numeric(14,2);
begin
  select expense_id into target_id from runtime_sales_expense;
  if (select status from public.sales_expenses where id = target_id) <> 'accounting_draft' then
    raise exception 'runtime_status_not_accounting_draft';
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into debit_total, credit_total
  from public.accounting_draft_entries
  where source_sales_expense_id = target_id;
  if debit_total <> 10700 or credit_total <> 10700 then
    raise exception 'runtime_draft_not_balanced debit=% credit=%', debit_total, credit_total;
  end if;
  if (select count(*) from public.accounting_draft_entries where source_sales_expense_id = target_id) <> 4 then
    raise exception 'runtime_expected_four_accounting_lines';
  end if;
  if exists(select 1 from public.accounting_draft_entries where document_id = '50000000-0000-4000-8000-000000000001' and account_code = '5200') then
    raise exception 'runtime_generic_draft_not_reclassified';
  end if;
  if not exists(select 1 from public.accounting_draft_entries where source_sales_expense_id = target_id and account_code = '6210' and debit = 10000) then
    raise exception 'runtime_sales_account_missing';
  end if;
  if not exists(select 1 from public.accounting_draft_entries where source_sales_expense_id = target_id and account_code = '1150' and debit = 700) then
    raise exception 'runtime_input_vat_missing';
  end if;
  if not exists(select 1 from public.accounting_draft_entries where source_sales_expense_id = target_id and account_code = '2100' and credit = 10500) then
    raise exception 'runtime_accounts_payable_missing';
  end if;
  if not exists(select 1 from public.accounting_draft_entries where source_sales_expense_id = target_id and account_code = '2150' and credit = 200) then
    raise exception 'runtime_withholding_payable_missing';
  end if;
  if (select count(*) from public.sales_expense_audit where sales_expense_id = target_id) <> 4 then
    raise exception 'runtime_audit_count_mismatch';
  end if;
  if has_table_privilege('authenticated', 'public.sales_expenses', 'INSERT') then
    raise exception 'runtime_direct_insert_privilege_not_revoked';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sales_expenses'::regclass) then
    raise exception 'runtime_rls_not_enabled';
  end if;
end;
$$;

rollback;

select 'sales expense PostgreSQL runtime smoke passed' as result;
