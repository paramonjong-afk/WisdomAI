-- The original migration chain starts by referencing public.profiles but did
-- not include the table's foundational migration. Keep this idempotent so it
-- is a no-op on established projects while fresh databases can replay the
-- complete migration history.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'employee',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

comment on table public.profiles is
  'Application identity profile. The foundational definition is intentionally minimal; later migrations add workforce and tenant fields.';
