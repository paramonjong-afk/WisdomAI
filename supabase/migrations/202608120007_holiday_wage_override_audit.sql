-- Holiday-work wage review. Attendance evidence and the ordinary day-unit override remain unchanged.

create table if not exists public.employee_holiday_wage_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  holiday_type text not null default 'company_holiday' check (holiday_type in ('weekly_holiday','traditional_holiday','company_holiday','other')),
  wage_multiplier numeric(4,2) not null check (wage_multiplier in (1,1.5,2,3)),
  holiday_overtime_minutes integer check (holiday_overtime_minutes is null or holiday_overtime_minutes >= 0),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  pay_period_id uuid references public.pay_periods(id) on delete restrict,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id, work_date)
);

create table if not exists public.employee_holiday_wage_override_audits (
  id bigint generated always as identity primary key,
  override_id uuid not null references public.employee_holiday_wage_overrides(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  actor_profile_id uuid not null references public.profiles(id),
  reason text not null,
  old_multiplier numeric(4,2),
  new_multiplier numeric(4,2) not null,
  old_holiday_overtime_minutes integer,
  new_holiday_overtime_minutes integer,
  created_at timestamptz not null default now()
);

create index if not exists employee_holiday_wage_overrides_lookup_idx
  on public.employee_holiday_wage_overrides(company_id, profile_id, work_date);
create index if not exists employee_holiday_wage_override_audits_lookup_idx
  on public.employee_holiday_wage_override_audits(company_id, profile_id, work_date, created_at desc);

alter table public.employee_holiday_wage_overrides enable row level security;
alter table public.employee_holiday_wage_override_audits enable row level security;
create policy "Company managers read holiday wage overrides" on public.employee_holiday_wage_overrides
  for select to authenticated using (public.is_company_manager(company_id));
create policy "Company managers read holiday wage override audits" on public.employee_holiday_wage_override_audits
  for select to authenticated using (public.is_company_manager(company_id));

create or replace function public.admin_set_employee_holiday_wage_override(
  target_profile_id uuid,
  target_work_date date,
  target_holiday_type text,
  target_multiplier numeric,
  target_holiday_overtime_minutes integer,
  override_reason text,
  target_pay_period_id uuid default null
) returns public.employee_holiday_wage_overrides
language plpgsql security definer set search_path = public
as $$
declare
  target_company_id uuid := public.current_company_id();
  before_row public.employee_holiday_wage_overrides;
  after_row public.employee_holiday_wage_overrides;
  period_status text;
begin
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'Permission denied'; end if;
  if target_holiday_type not in ('weekly_holiday','traditional_holiday','company_holiday','other') then raise exception 'Invalid holiday type'; end if;
  if target_multiplier not in (1,1.5,2,3) then raise exception 'Multiplier must be 1, 1.5, 2, or 3'; end if;
  if char_length(trim(coalesce(override_reason,''))) < 3 then raise exception 'Reason is required'; end if;
  if target_holiday_overtime_minutes is not null and target_holiday_overtime_minutes < 0 then raise exception 'Holiday overtime minutes must not be negative'; end if;
  if not exists (select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=target_profile_id and m.active) then raise exception 'Employee is not active in the current company'; end if;
  if target_pay_period_id is not null then
    select status into period_status from public.pay_periods where id=target_pay_period_id and company_id=target_company_id;
    if period_status is null then raise exception 'Pay period not found in current company'; end if;
    if period_status not in ('draft','open') then raise exception 'Locked pay period cannot be changed'; end if;
  end if;

  select * into before_row from public.employee_holiday_wage_overrides
   where company_id=target_company_id and profile_id=target_profile_id and work_date=target_work_date for update;

  insert into public.employee_holiday_wage_overrides(company_id,profile_id,work_date,holiday_type,wage_multiplier,holiday_overtime_minutes,reason,pay_period_id,created_by,updated_by)
  values(target_company_id,target_profile_id,target_work_date,target_holiday_type,target_multiplier,target_holiday_overtime_minutes,trim(override_reason),target_pay_period_id,auth.uid(),auth.uid())
  on conflict(company_id,profile_id,work_date) do update set holiday_type=excluded.holiday_type,wage_multiplier=excluded.wage_multiplier,holiday_overtime_minutes=excluded.holiday_overtime_minutes,reason=excluded.reason,pay_period_id=excluded.pay_period_id,updated_by=auth.uid(),updated_at=now()
  returning * into after_row;

  insert into public.employee_holiday_wage_override_audits(override_id,company_id,profile_id,work_date,actor_profile_id,reason,old_multiplier,new_multiplier,old_holiday_overtime_minutes,new_holiday_overtime_minutes)
  values(after_row.id,target_company_id,target_profile_id,target_work_date,auth.uid(),trim(override_reason),before_row.wage_multiplier,after_row.wage_multiplier,before_row.holiday_overtime_minutes,after_row.holiday_overtime_minutes);
  return after_row;
end;
$$;

revoke all on function public.admin_set_employee_holiday_wage_override(uuid,date,text,numeric,integer,text,uuid) from public;
grant execute on function public.admin_set_employee_holiday_wage_override(uuid,date,text,numeric,integer,text,uuid) to authenticated;

comment on table public.employee_holiday_wage_overrides is 'Audited company-scoped review of holiday wage multiplier and holiday overtime for report/forecast only.';
