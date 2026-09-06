-- Registered fund holders may inspect only their own registry, cases, and audit.
-- Company managers retain the existing company-wide policies.
drop policy if exists "Advance holders read own registry" on public.employee_advance_holders;
create policy "Advance holders read own registry" on public.employee_advance_holders
  for select to authenticated
  using(company_id=public.current_company_id() and holder_profile_id=auth.uid());

drop policy if exists "Advance holders read own aliases" on public.employee_advance_holder_aliases;
create policy "Advance holders read own aliases" on public.employee_advance_holder_aliases
  for select to authenticated
  using(exists(
    select 1 from public.employee_advance_holders holder
    where holder.id=holder_id
      and holder.company_id=public.current_company_id()
      and holder.holder_profile_id=auth.uid()
  ));

drop policy if exists "Advance holders read own holder audit" on public.employee_advance_holder_audit;
create policy "Advance holders read own holder audit" on public.employee_advance_holder_audit
  for select to authenticated
  using(company_id=public.current_company_id() and exists(
    select 1 from public.employee_advance_holders holder
    where holder.id=holder_id and holder.holder_profile_id=auth.uid()
  ));

drop policy if exists "Advance holders read own cases" on public.employee_advance_cases;
create policy "Advance holders read own cases" on public.employee_advance_cases
  for select to authenticated
  using(company_id=public.current_company_id() and holder_profile_id=auth.uid());

drop policy if exists "Advance holders read own settlement items" on public.employee_advance_settlement_items;
create policy "Advance holders read own settlement items" on public.employee_advance_settlement_items
  for select to authenticated
  using(exists(
    select 1 from public.employee_advance_cases advance_case
    where advance_case.id=case_id
      and advance_case.company_id=public.current_company_id()
      and advance_case.holder_profile_id=auth.uid()
  ));

drop policy if exists "Advance holders read own advance audit" on public.employee_advance_audit;
create policy "Advance holders read own advance audit" on public.employee_advance_audit
  for select to authenticated
  using(company_id=public.current_company_id() and exists(
    select 1 from public.employee_advance_cases advance_case
    where advance_case.id=case_id and advance_case.holder_profile_id=auth.uid()
  ));

notify pgrst,'reload schema';
