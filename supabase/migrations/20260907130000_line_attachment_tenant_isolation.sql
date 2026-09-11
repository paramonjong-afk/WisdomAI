-- DOC-INGEST-005: fail-closed logical duplicate linking and tenant-scoped attachment reads.
-- New duplicate links are company-scoped in the webhook. This migration closes the
-- remaining direct table/storage read paths without rewriting historical links.

drop policy if exists "Authenticated users can read line messages" on public.line_messages;
drop policy if exists "Authenticated users can read line attachments" on public.line_attachments;

alter table public.line_messages enable row level security;
alter table public.line_attachments enable row level security;

create policy "Company members can read line messages"
on public.line_messages
for select to authenticated
using (company_id = public.current_company_id());

create policy "Company members can read line attachments"
on public.line_attachments
for select to authenticated
using (company_id = public.current_company_id());

alter table public.line_attachment_blobs enable row level security;

drop policy if exists "Company members can read line attachment blobs" on public.line_attachment_blobs;
create policy "Company members can read line attachment blobs"
on public.line_attachment_blobs
for select to authenticated
using (company_id = public.current_company_id());

revoke all on table public.line_messages from anon;
revoke all on table public.line_attachments from anon;
revoke all on table public.line_attachment_blobs from anon;
revoke all on table public.line_messages from authenticated;
revoke all on table public.line_attachments from authenticated;
revoke all on table public.line_attachment_blobs from authenticated;
grant select on table public.line_messages to authenticated;
grant select on table public.line_attachments to authenticated;
grant select on table public.line_attachment_blobs to authenticated;

-- The old restrictive policy allowed every non-employee bucket, including
-- line-attachments, to satisfy the restrictive half of Storage SELECT. Exclude
-- LINE files so the company/document-flow policy is the only positive path.
drop policy if exists "Tenant employee storage visibility" on storage.objects;
create policy "Tenant employee storage visibility" on storage.objects
as restrictive for select to authenticated
using (
  bucket_id <> all(array[
    'attendance-selfies'::text,
    'employee-workforce-documents'::text,
    'employee-private-documents'::text
  ])
  or (storage.foldername(name))[1] = auth.uid()::text
  or exists (
    select 1
    from public.company_members m
    where m.company_id = public.current_company_id()
      and m.profile_id::text = (storage.foldername(name))[1]
      and m.active
      and public.is_company_manager(m.company_id)
  )
);

comment on table public.line_attachment_blobs is
  'Physical LINE blobs are company-scoped; authenticated reads require the active company and writes use service_role.';
