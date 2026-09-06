-- Web Chat attachments must be inspected by the trusted uploader before they can trigger Omni Intake.
drop policy if exists "Members can send chat messages" on public.chat_messages;
create policy "Members can send chat messages" on public.chat_messages
for insert to authenticated with check (
  room_id in (select id from public.chat_rooms where company_id = public.current_company_id())
  and sender_profile_id = auth.uid()
  and public.is_chat_room_member(room_id)
  and company_id = public.current_company_id()
  and attachment_path is null
);
drop policy if exists "Members in room can upload chat files" on storage.objects;
comment on table public.chat_messages is 'File messages are created by the trusted chat-attachment-upload Edge Function after byte inspection.';
