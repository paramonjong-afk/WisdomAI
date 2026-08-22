-- Central audit for authentication attempts that occur before a user session exists.
create table if not exists public.auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  outcome text not null check (outcome in ('success', 'failure')),
  reason text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists auth_login_attempts_created_idx
  on public.auth_login_attempts(created_at desc);
create index if not exists auth_login_attempts_email_created_idx
  on public.auth_login_attempts(email_hash, created_at desc);

alter table public.auth_login_attempts enable row level security;

create or replace function public.register_login_attempt(
  target_email text,
  target_outcome text,
  target_reason text default null,
  target_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if target_outcome not in ('success', 'failure') then
    raise exception 'invalid login outcome';
  end if;
  if length(trim(coalesce(target_email, ''))) = 0 then
    return;
  end if;
  insert into public.auth_login_attempts(email_hash, outcome, reason, user_agent)
  values (
    md5(lower(trim(target_email))),
    target_outcome,
    left(nullif(trim(target_reason), ''), 120),
    left(nullif(trim(target_user_agent), ''), 300)
  );
end;
$$;

revoke all on function public.register_login_attempt(text,text,text,text) from public, authenticated;
grant execute on function public.register_login_attempt(text,text,text,text) to anon;

-- Only privileged operators can inspect authentication-attempt metadata.
drop policy if exists "Admins read login attempts" on public.auth_login_attempts;
create policy "Admins read login attempts"
on public.auth_login_attempts for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
