-- Per-user read cursor for chat rooms. This keeps unread badges consistent
-- across devices without exposing another user's read position.
create table if not exists public.chat_room_read_states (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);

create index if not exists chat_room_read_states_profile_idx
  on public.chat_room_read_states(profile_id, updated_at desc);

alter table public.chat_room_read_states enable row level security;

create policy "Users read their own chat cursors" on public.chat_room_read_states
for select to authenticated using (
  profile_id = auth.uid()
  and exists (
    select 1 from public.chat_rooms room
    where room.id = chat_room_read_states.room_id
      and room.company_id = public.current_company_id()
      and (public.is_chat_room_member(room.id) or public.is_company_manager(room.company_id))
  )
);

create policy "Users write their own chat cursors" on public.chat_room_read_states
for insert to authenticated with check (
  profile_id = auth.uid()
  and exists (
    select 1 from public.chat_rooms room
    where room.id = chat_room_read_states.room_id
      and room.company_id = public.current_company_id()
      and (public.is_chat_room_member(room.id) or public.is_company_manager(room.company_id))
  )
);

create policy "Users update their own chat cursors" on public.chat_room_read_states
for update to authenticated using (
  profile_id = auth.uid()
) with check (
  profile_id = auth.uid()
  and exists (
    select 1 from public.chat_rooms room
    where room.id = chat_room_read_states.room_id
      and room.company_id = public.current_company_id()
      and (public.is_chat_room_member(room.id) or public.is_company_manager(room.company_id))
  )
);

grant select, insert, update on public.chat_room_read_states to authenticated;
