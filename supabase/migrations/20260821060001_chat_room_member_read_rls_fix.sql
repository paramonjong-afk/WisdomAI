-- Keep room-member reads scoped to the same room. The original nested
-- self-reference collapsed to `mine.room_id = mine.room_id`, which could
-- broaden visibility for company members.

drop policy if exists "Members can read room members" on public.chat_room_members;
create policy "Members can read room members" on public.chat_room_members
for select to authenticated using (
  public.current_company_id() is not null
  and exists (
    select 1 from public.chat_rooms room
    where room.id = chat_room_members.room_id
      and room.company_id = public.current_company_id()
      and (
        public.is_chat_room_member(room.id)
        or public.is_company_manager(room.company_id)
        or room.created_by = auth.uid()
      )
  )
);
