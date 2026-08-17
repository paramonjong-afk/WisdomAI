-- Reliable authenticated profile bootstrap without recursive profile RLS checks.
create or replace function public.get_my_profile()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path=public
as $$
  select profile.id, profile.full_name, profile.email, profile.role::text,
    profile.created_at, profile.updated_at
  from public.profiles profile
  where profile.id=auth.uid()
  limit 1
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;
