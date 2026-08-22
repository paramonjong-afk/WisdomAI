-- Keep room-member access for Web Chat attachments and additionally allow
-- company managers to review attachments from the central Intake workflow.
-- Object paths are scoped as: {company_id}/{room_id}/{filename}.

drop policy if exists "Members in company can view chat files" on storage.objects;
drop policy if exists "Members in room can upload chat files" on storage.objects;

create policy "Members and managers can view chat files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (
    public.is_company_member((storage.foldername(name))[1]::uuid)
    or public.is_company_manager((storage.foldername(name))[1]::uuid)
  )
);

create policy "Members and managers can upload chat files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (
    (
      public.is_company_member((storage.foldername(name))[1]::uuid)
      and public.is_chat_room_member((storage.foldername(name))[2]::uuid)
    )
    or public.is_company_manager((storage.foldername(name))[1]::uuid)
  )
);
