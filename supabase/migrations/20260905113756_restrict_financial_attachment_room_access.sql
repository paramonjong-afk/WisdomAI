-- DOC-INGEST-004: keep financial/chat evidence private to the room that owns it.
-- Storage SELECT policies are permissive by default, so every obsolete broad
-- policy must be removed rather than relying on a narrower policy to override it.
drop policy if exists "Authenticated users can view stored LINE files" on storage.objects;
drop policy if exists "Company members view LINE files" on storage.objects;
drop policy if exists "Company members view chat files" on storage.objects;
drop policy if exists "Members in company can view chat files" on storage.objects;
drop policy if exists "Members and managers can view chat files" on storage.objects;

create policy "Room members and company managers view chat files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and case
    when coalesce((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce((storage.foldername(name))[2], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then exists (
      select 1
      from public.chat_rooms room
      where room.id = (storage.foldername(objects.name))[2]::uuid
        and room.company_id = (storage.foldername(objects.name))[1]::uuid
        and (
          public.is_company_manager(room.company_id)
          or (
            public.is_company_member(room.company_id)
            and public.is_chat_room_member(room.id)
          )
        )
    )
    else false
  end
);

comment on policy "Room members and company managers view chat files" on storage.objects is
  'Private chat evidence: room members and company managers only. The object company/room path must match the persisted chat_rooms row; malformed paths fail closed.';
