create table if not exists public.app_activity_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'session_start', 'session_end', 'page_view', 'client_error', 'request_error'
  )),
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  page_path text,
  message text,
  device_id text,
  device_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_activity_logs_profile_created_idx
  on public.app_activity_logs(profile_id, created_at desc);
create index if not exists app_activity_logs_severity_created_idx
  on public.app_activity_logs(severity, created_at desc);

alter table public.app_activity_logs enable row level security;

drop policy if exists "Users insert own activity logs" on public.app_activity_logs;
create policy "Users insert own activity logs"
on public.app_activity_logs for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists "Users and managers read activity logs" on public.app_activity_logs;
create policy "Users and managers read activity logs"
on public.app_activity_logs for select to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'manager')
  )
);

create table if not exists public.user_app_status (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id text not null,
  status text not null default 'online' check (status in ('online', 'away', 'offline')),
  current_path text,
  device_label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (profile_id, device_id)
);

create index if not exists user_app_status_last_seen_idx
  on public.user_app_status(last_seen_at desc);

alter table public.user_app_status enable row level security;

drop policy if exists "Users insert own app status" on public.user_app_status;
create policy "Users insert own app status"
on public.user_app_status for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists "Users update own app status" on public.user_app_status;
create policy "Users update own app status"
on public.user_app_status for update to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists "Users and managers read app status" on public.user_app_status;
create policy "Users and managers read app status"
on public.user_app_status for select to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'manager')
  )
);

