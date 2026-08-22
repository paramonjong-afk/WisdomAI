-- Web chat rooms, members, messages, and attachment handling.
create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 140),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_profile_id uuid references public.profiles(id) on delete set null,
  message_type text not null default 'text' check (message_type in ('text', 'file')),
  text_content text,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  attachment_content_type text,
  attachment_size bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (coalesce(trim(text_content), '') <> '' or attachment_path is not null),
  check (attachment_path is null or attachment_bucket is not null)
);

create index if not exists chat_rooms_company_updated_idx on public.chat_rooms(company_id, updated_at desc);
create index if not exists chat_rooms_company_created_idx on public.chat_rooms(company_id, created_at desc);
create unique index if not exists chat_room_members_room_profile_key on public.chat_room_members(room_id, profile_id);
create index if not exists chat_messages_room_created_idx on public.chat_messages(room_id, created_at desc);
create index if not exists chat_messages_company_idx on public.chat_messages(company_id, created_at desc);
create index if not exists chat_messages_sender_idx on public.chat_messages(sender_profile_id);

create or replace function public.is_chat_room_member(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.chat_room_members m
    where m.room_id = target_room_id
      and m.profile_id = auth.uid()
  );
$$;

create or replace function public.is_chat_room_owner(target_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.chat_room_members m
    where m.room_id = target_room_id
      and m.profile_id = auth.uid()
      and m.member_role = 'owner'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger chat_rooms_touch_updated_at
before update on public.chat_rooms
for each row
execute function public.touch_updated_at();

create trigger chat_messages_touch_updated_at
before update on public.chat_messages
for each row
execute function public.touch_updated_at();

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;

create policy "Members read their chat rooms" on public.chat_rooms
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_member(id)
    or public.is_company_manager(company_id)
  )
);

create policy "Members create chat rooms" on public.chat_rooms
for insert to authenticated with check (
  company_id = public.current_company_id()
  and public.is_company_member(public.current_company_id())
);

create policy "Owners or managers update chat rooms" on public.chat_rooms
for update to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_owner(id) or public.is_company_manager(company_id)
  )
) with check (
  company_id = public.current_company_id() and public.is_company_manager(company_id)
);

create policy "Owners or managers delete chat rooms" on public.chat_rooms
for delete to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_owner(id) or public.is_company_manager(company_id)
  )
);

create policy "Members can read room members" on public.chat_room_members
for select to authenticated using (
  public.current_company_id() is not null and (
    exists (
      select 1 from public.chat_rooms room
      where room.id = room_id
        and room.company_id = public.current_company_id()
        and (
          exists (
            select 1 from public.chat_room_members mine
            where mine.room_id = room_id and mine.profile_id = auth.uid()
          )
          or public.is_company_manager(room.company_id)
        )
    )
  )
);

create policy "Managers and room owners can manage room members" on public.chat_room_members
for all to authenticated using (
  exists (
    select 1 from public.chat_rooms room
    where room.id = room_id
      and room.company_id = public.current_company_id()
      and (
        public.is_company_manager(room.company_id)
        or (public.is_chat_room_owner(room_id) and public.current_company_id() = room.company_id)
      )
  )
) with check (
  exists (
    select 1 from public.chat_rooms room
    where room.id = room_id
      and room.company_id = public.current_company_id()
      and (
        public.is_company_manager(room.company_id)
        or (public.is_chat_room_owner(room_id) and public.current_company_id() = room.company_id)
      )
  )
);

create policy "Members can read chat messages" on public.chat_messages
for select to authenticated using (
  company_id = public.current_company_id() and public.is_chat_room_member(room_id)
);

create policy "Members can send chat messages" on public.chat_messages
for insert to authenticated with check (
  room_id in (select id from public.chat_rooms where company_id = public.current_company_id())
  and sender_profile_id = auth.uid()
  and public.is_chat_room_member(room_id)
  and company_id = public.current_company_id()
);

create policy "Senders and managers can update chat messages" on public.chat_messages
for update to authenticated using (
  company_id = public.current_company_id()
  and (public.is_company_manager(company_id) or sender_profile_id = auth.uid())
) with check (
  company_id = public.current_company_id()
  and public.is_chat_room_member(room_id)
);

create policy "Managers can delete chat messages" on public.chat_messages
for delete to authenticated using (
  public.current_company_id() is not null
  and company_id = public.current_company_id()
  and public.is_company_manager(company_id)
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'chat-attachments',
  'chat-attachments',
  false,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Company members view LINE files" on storage.objects;

drop policy if exists "Company members view chat files" on storage.objects;
drop policy if exists "Room members upload chat files" on storage.objects;
drop policy if exists "Company managers delete chat files" on storage.objects;

create policy "Members in company can view chat files" on storage.objects
for select to authenticated using (
  bucket_id = 'chat-attachments'
  and public.is_company_member((storage.foldername(name))[1]::uuid)
);

create policy "Members in room can upload chat files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'chat-attachments'
  and public.is_company_member((storage.foldername(name))[1]::uuid)
  and public.is_chat_room_member((storage.foldername(name))[2]::uuid)
);

create policy "Managers can delete chat files" on storage.objects
for delete to authenticated using (
  bucket_id = 'chat-attachments'
  and public.is_company_manager((storage.foldername(name))[1]::uuid)
);

grant select, insert, update, delete on public.chat_rooms to authenticated;
grant select, insert, update, delete on public.chat_room_members to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;
grant execute on function public.is_chat_room_member(uuid) to authenticated;
grant execute on function public.is_chat_room_owner(uuid) to authenticated;
