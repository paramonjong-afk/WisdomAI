-- Room owners and company managers may rename rooms within the active company.
-- The original update policy allowed owners in USING but only managers in WITH CHECK.
drop policy if exists "Owners or managers update chat rooms" on public.chat_rooms;

create policy "Owners or managers update chat rooms" on public.chat_rooms
for update to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_owner(id) or public.is_company_manager(company_id)
  )
) with check (
  company_id = public.current_company_id() and (
    public.is_chat_room_owner(id) or public.is_company_manager(company_id)
  )
);
