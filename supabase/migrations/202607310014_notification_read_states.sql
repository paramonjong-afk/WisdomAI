create table if not exists public.notification_read_states(
  profile_id uuid not null references public.profiles(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  primary key(profile_id,notification_key)
);
alter table public.notification_read_states enable row level security;
create policy "Users manage own notification read state" on public.notification_read_states
for all to authenticated using(profile_id=auth.uid()) with check(profile_id=auth.uid());
