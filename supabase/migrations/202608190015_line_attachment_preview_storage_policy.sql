-- Signed URLs use the caller's Storage SELECT policy. A restrictive tenant
-- policy alone is not sufficient. Access is deliberately no wider than the
-- Document Flow item the caller is already allowed to read.
drop policy if exists "Company members view LINE attachment storage" on storage.objects;
create policy "Company members view LINE attachment storage"
  on storage.objects for select to authenticated
  using (
    bucket_id='line-attachments'
    and exists (
      select 1 from public.line_attachments attachment
      join public.document_flow_items item on item.source_message_id=attachment.message_id
      where attachment.storage_bucket=objects.bucket_id
        and attachment.storage_path=objects.name
        and attachment.company_id=public.current_company_id()
        and public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity)
    )
  );
