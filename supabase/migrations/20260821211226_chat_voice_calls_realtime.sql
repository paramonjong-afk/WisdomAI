-- Restrict WebRTC signalling to the active company context. Media stays peer-to-peer;
-- this channel only carries short-lived offer/answer/ICE/call-state messages.
drop policy if exists "Company members can receive chat call signals" on "realtime"."messages";
drop policy if exists "Company members can send chat call signals" on "realtime"."messages";

create policy "Company members can receive chat call signals"
on "realtime"."messages"
for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.chat_rooms room
    where realtime.topic() = ('chat-calls:' || (select public.current_company_id())::text || ':' || room.id::text)
      and room.company_id = (select public.current_company_id())
      and (
        public.is_chat_room_member(room.id)
        or public.is_company_manager(room.company_id)
      )
  )
);

create policy "Company members can send chat call signals"
on "realtime"."messages"
for insert
to authenticated
with check (
  extension = 'broadcast'
  and exists (
    select 1
    from public.chat_rooms room
    where realtime.topic() = ('chat-calls:' || (select public.current_company_id())::text || ':' || room.id::text)
      and room.company_id = (select public.current_company_id())
      and (
        public.is_chat_room_member(room.id)
        or public.is_company_manager(room.company_id)
      )
  )
);
