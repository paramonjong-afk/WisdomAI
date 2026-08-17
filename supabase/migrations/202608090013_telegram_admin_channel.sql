begin;

create table if not exists public.telegram_admin_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  telegram_user_id text not null,
  username text,
  display_name text,
  active boolean not null default true,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,profile_id),
  unique(company_id,telegram_user_id)
);

create table if not exists public.telegram_admin_chats (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  telegram_chat_id text not null,
  title text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,telegram_chat_id)
);

create table if not exists public.telegram_admin_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  telegram_update_id text not null unique,
  telegram_chat_id text,
  telegram_user_id text,
  event_type text not null,
  command text,
  status text not null default 'received' check(status in ('received','processed','ignored','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists telegram_admin_accounts_profile_idx on public.telegram_admin_accounts(profile_id,active);
create index if not exists telegram_admin_chats_company_idx on public.telegram_admin_chats(company_id,active);
create index if not exists telegram_admin_events_company_idx on public.telegram_admin_events(company_id,created_at desc);

alter table public.telegram_admin_accounts enable row level security;
alter table public.telegram_admin_chats enable row level security;
alter table public.telegram_admin_events enable row level security;

create policy "Managers read Telegram admin accounts" on public.telegram_admin_accounts
for select to authenticated using(public.is_company_manager(company_id));
create policy "Company admins manage Telegram admin accounts" on public.telegram_admin_accounts
for all to authenticated using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));

create policy "Managers read Telegram admin chats" on public.telegram_admin_chats
for select to authenticated using(public.is_company_manager(company_id));
create policy "Company admins manage Telegram admin chats" on public.telegram_admin_chats
for all to authenticated using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));

create policy "Managers read Telegram admin events" on public.telegram_admin_events
for select to authenticated using(company_id is not null and public.is_company_manager(company_id));

revoke insert,update,delete on public.telegram_admin_events from anon,authenticated;

commit;
