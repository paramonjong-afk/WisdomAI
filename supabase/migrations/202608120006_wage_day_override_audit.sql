-- Admin override for forecast wage-day units. Attendance evidence remains unchanged.

create table if not exists public.employee_wage_day_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  day_units numeric(3,2) not null check (day_units in (0, 0.5, 1)),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id, work_date)
);

create table if not exists public.employee_wage_day_override_audits (
  id bigint generated always as identity primary key,
  override_id uuid not null references public.employee_wage_day_overrides(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  actor_profile_id uuid not null references public.profiles(id),
  action text not null check (action in ('create', 'update')),
  reason text not null,
  old_day_units numeric(3,2),
  new_day_units numeric(3,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists employee_wage_day_overrides_lookup_idx
  on public.employee_wage_day_overrides(company_id, profile_id, work_date);
create index if not exists employee_wage_day_override_audits_lookup_idx
  on public.employee_wage_day_override_audits(company_id, profile_id, work_date, created_at desc);

alter table public.employee_wage_day_overrides enable row level security;
alter table public.employee_wage_day_override_audits enable row level security;

create policy "Company managers read wage day overrides"
  on public.employee_wage_day_overrides for select to authenticated
  using (public.is_company_manager(company_id));
create policy "Company managers read wage day override audits"
  on public.employee_wage_day_override_audits for select to authenticated
  using (public.is_company_manager(company_id));

create or replace function public.admin_set_employee_wage_day_override(
  target_profile_id uuid,
  target_work_date date,
  target_day_units numeric,
  override_reason text
) returns public.employee_wage_day_overrides
language plpgsql security definer set search_path = public
as $$
declare
  target_company_id uuid := public.current_company_id();
  before_row public.employee_wage_day_overrides;
  after_row public.employee_wage_day_overrides;
  audit_action text;
begin
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'Permission denied';
  end if;
  if target_day_units not in (0, 0.5, 1) then
    raise exception 'Day units must be 0, 0.5, or 1';
  end if;
  if char_length(trim(coalesce(override_reason, ''))) < 3 then
    raise exception 'Reason is required';
  end if;
  if not exists (
    select 1 from public.company_members member
    where member.company_id = target_company_id
      and member.profile_id = target_profile_id
      and member.active
      and (member.ends_on is null or member.ends_on >= target_work_date)
  ) then
    raise exception 'Employee is not active in the current company';
  end if;

  select * into before_row
  from public.employee_wage_day_overrides
  where company_id = target_company_id
    and profile_id = target_profile_id
    and work_date = target_work_date
  for update;

  audit_action := case when found then 'update' else 'create' end;

  insert into public.employee_wage_day_overrides(
    company_id, profile_id, work_date, day_units, reason, created_by, updated_by
  ) values (
    target_company_id, target_profile_id, target_work_date, target_day_units,
    trim(override_reason), auth.uid(), auth.uid()
  )
  on conflict (company_id, profile_id, work_date) do update set
    day_units = excluded.day_units,
    reason = excluded.reason,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into after_row;

  insert into public.employee_wage_day_override_audits(
    override_id, company_id, profile_id, work_date, actor_profile_id,
    action, reason, old_day_units, new_day_units
  ) values (
    after_row.id, target_company_id, target_profile_id, target_work_date, auth.uid(),
    audit_action, trim(override_reason), before_row.day_units, after_row.day_units
  );

  return after_row;
end;
$$;

revoke all on function public.admin_set_employee_wage_day_override(uuid,date,numeric,text) from public;
grant execute on function public.admin_set_employee_wage_day_override(uuid,date,numeric,text) to authenticated;

comment on table public.employee_wage_day_overrides is
  'Audited Admin override of calculated wage-day units for report/forecast only; attendance evidence is unchanged.';
