-- Restrict accounting source documents and dependent rows to the active tenant
-- and approved accounting/review roles. Raw files and source records are unchanged.
drop policy if exists "Authenticated users read accounting documents" on public.accounting_documents;
drop policy if exists "Authenticated users read accounting document lines" on public.accounting_document_lines;
drop policy if exists "Authenticated users read accounting drafts" on public.accounting_draft_entries;

create policy "Approved accounting readers read accounting documents" on public.accounting_documents
  for select to authenticated using (
    company_id = public.current_company_id() and (
      public.is_platform_admin() or public.is_company_manager(company_id)
      or exists (select 1 from public.company_members member where member.company_id=accounting_documents.company_id and member.profile_id=auth.uid() and member.active and (member.ends_on is null or member.ends_on>=current_date) and member.company_role='accounting_hr')
      or exists (select 1 from public.document_flow_department_members member where member.company_id=accounting_documents.company_id and member.profile_id=auth.uid() and lower(member.department)=any(array['accounting','finance','audit','auditor']))
    )
  );

create policy "Approved accounting readers read accounting document lines" on public.accounting_document_lines
  for select to authenticated using (
    company_id = public.current_company_id() and (
      public.is_platform_admin() or public.is_company_manager(company_id)
      or exists (select 1 from public.company_members member where member.company_id=accounting_document_lines.company_id and member.profile_id=auth.uid() and member.active and (member.ends_on is null or member.ends_on>=current_date) and member.company_role='accounting_hr')
      or exists (select 1 from public.document_flow_department_members member where member.company_id=accounting_document_lines.company_id and member.profile_id=auth.uid() and lower(member.department)=any(array['accounting','finance','audit','auditor']))
    )
  );

create policy "Approved accounting readers read accounting drafts" on public.accounting_draft_entries
  for select to authenticated using (
    company_id = public.current_company_id() and (
      public.is_platform_admin() or public.is_company_manager(company_id)
      or exists (select 1 from public.company_members member where member.company_id=accounting_draft_entries.company_id and member.profile_id=auth.uid() and member.active and (member.ends_on is null or member.ends_on>=current_date) and member.company_role='accounting_hr')
      or exists (select 1 from public.document_flow_department_members member where member.company_id=accounting_draft_entries.company_id and member.profile_id=auth.uid() and lower(member.department)=any(array['accounting','finance','audit','auditor']))
    )
  );
