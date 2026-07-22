create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(), name text not null, code text unique,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('owner', 'manager', 'member', 'viewer')),
  created_at timestamptz not null default now(), primary key (project_id, profile_id)
);

create table if not exists public.line_groups (
  id uuid primary key default gen_random_uuid(), line_group_id text not null unique,
  display_name text, project_id uuid references public.projects(id) on delete set null,
  active boolean not null default true, joined_at timestamptz, last_event_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.line_senders (
  line_user_id text primary key, display_name text, picture_url text,
  profile_id uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.line_messages (
  id uuid primary key default gen_random_uuid(), webhook_event_id text not null unique,
  line_message_id text unique, line_group_id text references public.line_groups(line_group_id) on delete set null,
  line_user_id text references public.line_senders(line_user_id) on delete set null,
  message_type text not null, text_content text, file_name text, file_size bigint,
  quoted_message_id text, occurred_at timestamptz not null,
  is_redelivery boolean not null default false, is_unsent boolean not null default false,
  raw_event jsonb not null, created_at timestamptz not null default now()
);

create table if not exists public.line_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.line_messages(id) on delete cascade,
  storage_bucket text not null default 'line-attachments', storage_path text not null unique,
  content_type text, size_bytes bigint, created_at timestamptz not null default now()
);

create table if not exists public.work_summary_items (
  id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete set null,
  source_message_id uuid not null unique references public.line_messages(id) on delete cascade,
  work_date date not null,
  category text not null check (category in ('completed', 'in_progress', 'planned', 'issue', 'risk', 'material', 'safety', 'general')),
  summary_text text not null, assignee_text text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists line_messages_group_time_idx on public.line_messages(line_group_id, occurred_at desc);
create index if not exists work_summary_items_date_idx on public.work_summary_items(work_date desc, project_id);

insert into storage.buckets (id, name, public) values ('line-attachments', 'line-attachments', false)
on conflict (id) do update set public = false;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.line_groups enable row level security;
alter table public.line_senders enable row level security;
alter table public.line_messages enable row level security;
alter table public.line_attachments enable row level security;
alter table public.work_summary_items enable row level security;

create or replace function public.is_work_manager()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'manager')); $$;

create policy "Authenticated users can read work projects" on public.projects for select to authenticated using (true);
create policy "Authenticated users can read project members" on public.project_members for select to authenticated using (true);
create policy "Authenticated users can read line groups" on public.line_groups for select to authenticated using (true);
create policy "Authenticated users can read line senders" on public.line_senders for select to authenticated using (true);
create policy "Authenticated users can read line messages" on public.line_messages for select to authenticated using (true);
create policy "Authenticated users can read line attachments" on public.line_attachments for select to authenticated using (true);
create policy "Authenticated users can read work summaries" on public.work_summary_items for select to authenticated using (true);
create policy "Authenticated users can review work summaries" on public.work_summary_items
for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager() and reviewed_by = auth.uid());
create policy "Managers can create work projects" on public.projects
for insert to authenticated with check (public.is_work_manager() and created_by = auth.uid());
create policy "Managers can update work projects" on public.projects
for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers can map LINE groups" on public.line_groups
for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Authenticated users can view stored LINE files" on storage.objects
for select to authenticated using (bucket_id = 'line-attachments');

comment on table public.line_messages is 'New LINE webhook messages only; LINE does not provide automatic chat-history retrieval.';
