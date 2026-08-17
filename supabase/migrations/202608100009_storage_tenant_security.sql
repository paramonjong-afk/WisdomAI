-- TEN-009: company-isolated Storage policies with controlled legacy fallback.
update storage.buckets
set allowed_mime_types=array[
  'text/csv','application/csv','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf'
]
where id='boq-imports';

drop policy if exists "Authenticated users can view stored LINE files" on storage.objects;
drop policy if exists "Managers upload drawings" on storage.objects;
drop policy if exists "Authenticated users view drawings" on storage.objects;
drop policy if exists "Managers upload BOQ source files" on storage.objects;
drop policy if exists "Managers read BOQ source files" on storage.objects;
drop policy if exists "Managers remove own BOQ source files" on storage.objects;

create policy "Company members view LINE files" on storage.objects for select to authenticated using (
  bucket_id='line-attachments' and ((storage.foldername(name))[1]=public.current_company_id()::text or exists (
    select 1 from public.line_attachments a where a.storage_path=name and a.company_id=public.current_company_id()
  ))
);
create policy "Company managers upload drawings" on storage.objects for insert to authenticated with check (
  bucket_id='drawing-ai' and public.is_company_manager(public.current_company_id())
  and (storage.foldername(name))[1]=public.current_company_id()::text
);
create policy "Company members view drawings" on storage.objects for select to authenticated using (
  bucket_id='drawing-ai' and ((storage.foldername(name))[1]=public.current_company_id()::text or exists (
    select 1 from public.drawing_ai_jobs j where j.storage_path=name and j.company_id=public.current_company_id()
  ))
);
create policy "Company managers upload BOQ source files" on storage.objects for insert to authenticated with check (
  bucket_id='boq-imports' and public.is_company_manager(public.current_company_id())
  and (storage.foldername(name))[1]=public.current_company_id()::text
  and (storage.foldername(name))[2]=auth.uid()::text
);
create policy "Company managers read BOQ source files" on storage.objects for select to authenticated using (
  bucket_id='boq-imports' and public.is_company_manager(public.current_company_id()) and (
    (storage.foldername(name))[1]=public.current_company_id()::text or exists (
      select 1 from public.boq_items i join public.boq_documents d on d.id=i.boq_document_id
      where d.company_id=public.current_company_id() and i.source_reference->>'storage_path' like ('%'||name||'%')
    )
  )
);
create policy "Company managers remove own BOQ source files" on storage.objects for delete to authenticated using (
  bucket_id='boq-imports' and public.is_company_manager(public.current_company_id()) and (
    ((storage.foldername(name))[1]=public.current_company_id()::text and (storage.foldername(name))[2]=auth.uid()::text)
    or ((storage.foldername(name))[1]=auth.uid()::text and exists (
      select 1 from public.boq_items i join public.boq_documents d on d.id=i.boq_document_id
      where d.company_id=public.current_company_id() and i.source_reference->>'storage_path' like ('%'||name||'%')
    ))
  )
);
