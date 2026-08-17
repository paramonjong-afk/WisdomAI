create table if not exists public.attendance_gps_error_policies(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  error_code text not null,
  action text not null default 'review' check(action in ('allow','review','reject')),
  require_selfie boolean not null default true,
  require_reason boolean not null default true,
  notify_line boolean not null default true,
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(company_id,error_code)
);
alter table public.attendance_gps_error_policies enable row level security;
create policy "Company members read GPS error policies" on public.attendance_gps_error_policies
  for select to authenticated using(company_id=public.current_company_id());
create policy "Company managers manage GPS error policies" on public.attendance_gps_error_policies
  for all to authenticated using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));

insert into public.attendance_gps_error_policies(company_id,error_code,action,require_selfie,require_reason,notify_line)
select company.id,policy.error_code,policy.action,true,true,true
from public.companies company cross join (values
  ('permission_denied','review'),('position_unavailable','review'),('location_timeout','review'),
  ('gps_unsupported','review'),('gps_unavailable','review'),('gps_inaccurate','review'),
  ('outside_site','review'),('invalid_coordinate','reject'),('no_assigned_site','reject'),('suspected_spoofing','reject')
) as policy(error_code,action)
on conflict(company_id,error_code) do nothing;

create index if not exists attendance_gps_error_policies_company_idx
  on public.attendance_gps_error_policies(company_id,active,error_code);
