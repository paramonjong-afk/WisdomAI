create table if not exists public.project_sites (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  name text not null, latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null default 200 check (radius_meters between 20 and 5000),
  line_group_id text references public.line_groups(line_group_id) on delete set null,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(project_id, name)
);

create table if not exists public.employee_site_assignments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.project_sites(id) on delete cascade,
  starts_on date not null default current_date, ends_on date, active boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  primary key(profile_id, site_id), check (ends_on is null or ends_on >= starts_on)
);

create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id),
  site_id uuid not null references public.project_sites(id), clock_in_at timestamptz not null default now(), clock_out_at timestamptz,
  clock_in_latitude double precision not null, clock_in_longitude double precision not null, clock_in_accuracy_meters double precision,
  clock_out_latitude double precision, clock_out_longitude double precision, clock_out_accuracy_meters double precision,
  clock_in_distance_meters double precision, clock_out_distance_meters double precision,
  clock_in_selfie_path text, clock_out_selfie_path text, note text,
  status text not null default 'pending' check (status in ('pending','normal','needs_review','approved','rejected')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at >= clock_in_at)
);
create unique index if not exists one_open_attendance_per_employee on public.attendance_sessions(profile_id) where clock_out_at is null;
create index if not exists attendance_profile_time_idx on public.attendance_sessions(profile_id, clock_in_at desc);

insert into storage.buckets(id,name,public) values ('attendance-selfies','attendance-selfies',false)
on conflict(id) do update set public=false;

alter table public.project_sites enable row level security;
alter table public.employee_site_assignments enable row level security;
alter table public.attendance_sessions enable row level security;
create policy "Authenticated can read sites" on public.project_sites for select to authenticated using (active or public.is_work_manager());
create policy "Managers manage sites" on public.project_sites for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read assignments" on public.employee_site_assignments for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage assignments" on public.employee_site_assignments for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read attendance" on public.attendance_sessions for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Employees create attendance" on public.attendance_sessions for insert to authenticated with check (profile_id=auth.uid());
create policy "Employees update open attendance" on public.attendance_sessions for update to authenticated using (profile_id=auth.uid() and clock_out_at is null) with check (profile_id=auth.uid());
create policy "Managers review attendance" on public.attendance_sessions for update to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees upload own selfies" on storage.objects for insert to authenticated with check (bucket_id='attendance-selfies' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Attendance selfies readable by owner or manager" on storage.objects for select to authenticated using (bucket_id='attendance-selfies' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_work_manager()));
