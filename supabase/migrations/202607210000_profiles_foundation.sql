-- The original migration chain starts by referencing public.profiles but did
-- not include the table's foundational migration. Keep this idempotent so it
-- is a no-op on established projects while fresh databases can replay the
-- complete migration history.
do $$
begin
if to_regclass('public.profiles') is null then
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
end if;
end;
$$;

-- The deployed project schema predates the checked-in migration history and
-- carries both the legacy project_id/project_name fields and the canonical
-- id/name fields. Fresh replay needs the same bridge so the relationship
-- repair migrations can validate both generations without rewriting IDs.
do $$
begin
if to_regclass('public.projects') is null then
create table if not exists public.projects (
  project_id uuid primary key default gen_random_uuid(),
  project_name text,
  project_code text,
  id uuid not null unique default gen_random_uuid(),
  name text not null default '',
  code text unique,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;
end if;
end;
$$;
