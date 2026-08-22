-- Allow a room creator to finish the initial owner membership handshake.
-- The original flow inserted a room and immediately selected it before the
-- creator had a membership row, so RLS hid the just-created room. It also
-- attempted owner + invitee in one statement, which blocked non-managers.

drop policy if exists "Members read their chat rooms" on public.chat_rooms;
create policy "Members read their chat rooms" on public.chat_rooms
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_member(id)
    or public.is_company_manager(company_id)
    or created_by = auth.uid()
  )
);

drop policy if exists "Managers and room owners can manage room members" on public.chat_room_members;
create policy "Managers and room owners can manage room members" on public.chat_room_members
for all to authenticated using (
  exists (
    select 1 from public.chat_rooms room
    where room.id = room_id
      and room.company_id = public.current_company_id()
      and (
        public.is_company_manager(room.company_id)
        or public.is_chat_room_owner(room_id)
        or (room.created_by = auth.uid() and profile_id = auth.uid())
      )
  )
) with check (
  exists (
    select 1 from public.chat_rooms room
    where room.id = room_id
      and room.company_id = public.current_company_id()
      and (
        public.is_company_manager(room.company_id)
        or public.is_chat_room_owner(room_id)
        or (
          room.created_by = auth.uid()
          and profile_id = auth.uid()
          and member_role = 'owner'
        )
      )
  )
);
