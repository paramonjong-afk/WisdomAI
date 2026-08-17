-- Configurable work schedules, automatic semi-monthly pay cycles, and
-- contractor accounting kept separate from employee payroll.

create table if not exists public.pay_cycle_settings (
  singleton boolean primary key default true check(singleton),
  first_period_end_day integer not null default 15 check(first_period_end_day between 1 and 27),
  first_pay_day integer not null default 20 check(first_pay_day between 1 and 28),
  second_pay_day integer not null default 5 check(second_pay_day between 1 and 28),
  second_pay_month_offset integer not null default 1 check(second_pay_month_offset between 0 and 1),
  holiday_adjustment text not null default 'previous_workday'
    check(holiday_adjustment in ('previous_workday','next_workday','none')),
  active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.pay_cycle_settings(singleton) values(true) on conflict(singleton) do nothing;
alter table public.pay_cycle_settings enable row level security;
create policy "Authenticated read pay cycle settings" on public.pay_cycle_settings
  for select to authenticated using(true);
create policy "Managers manage pay cycle settings" on public.pay_cycle_settings
  for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());

create or replace function public.adjust_pay_date(target_date date, adjustment text)
returns date language plpgsql stable set search_path=public as $$
declare result_date date:=target_date;
declare direction integer:=case when adjustment='previous_workday' then -1 else 1 end;
begin
  if adjustment='none' then return result_date; end if;
  while extract(isodow from result_date)::integer in (6,7)
    or exists(select 1 from public.company_holidays where holiday_date=result_date and site_id is null)
  loop
    result_date:=result_date+direction;
  end loop;
  return result_date;
end;
$$;

create or replace function public.ensure_semimonthly_pay_periods(target_year integer, target_month integer)
returns setof public.pay_periods
language plpgsql security definer set search_path=public as $$
declare setting public.pay_cycle_settings;
declare month_start date;
declare month_end date;
declare first_end date;
declare first_pay date;
declare second_pay date;
declare created public.pay_periods;
begin
  if auth.uid() is not null and not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if target_year not between 2000 and 2200 or target_month not between 1 and 12 then raise exception 'Invalid month'; end if;
  select * into setting from public.pay_cycle_settings where singleton=true;
  month_start:=make_date(target_year,target_month,1);
  month_end:=(month_start+interval '1 month-1 day')::date;
  first_end:=least(month_end,make_date(target_year,target_month,setting.first_period_end_day));
  first_pay:=public.adjust_pay_date(make_date(target_year,target_month,setting.first_pay_day),setting.holiday_adjustment);
  second_pay:=public.adjust_pay_date(
    (month_start+make_interval(months=>setting.second_pay_month_offset)
      +(setting.second_pay_day-1)*interval '1 day')::date,
    setting.holiday_adjustment
  );

  insert into public.pay_periods(name,starts_on,ends_on,pay_date)
  values(
    format('รอบ 1-%s %s',setting.first_period_end_day,to_char(month_start,'MM/YYYY')),
    month_start,first_end,first_pay
  ) on conflict(starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
  returning * into created;
  return next created;

  if first_end<month_end then
    insert into public.pay_periods(name,starts_on,ends_on,pay_date)
    values(
      format('รอบ %s-สิ้นเดือน %s',setting.first_period_end_day+1,to_char(month_start,'MM/YYYY')),
      first_end+1,month_end,second_pay
    ) on conflict(starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
    returning * into created;
    return next created;
  end if;
end;
$$;
grant execute on function public.ensure_semimonthly_pay_periods(integer,integer) to authenticated;

create extension if not exists pg_cron;
do $$
begin
  if not exists(select 1 from cron.job where jobname='create-monthly-semimonthly-pay-periods') then
    perform cron.schedule(
      'create-monthly-semimonthly-pay-periods',
      '5 17 25 * *',
      $job$
        select public.ensure_semimonthly_pay_periods(
          extract(year from (now() at time zone 'Asia/Bangkok' + interval '1 month'))::integer,
          extract(month from (now() at time zone 'Asia/Bangkok' + interval '1 month'))::integer
        );
      $job$
    );
  end if;
end;
$$;

create table if not exists public.contractor_vendors (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  contact_name text,
  phone text,
  tax_id text,
  vendor_type text not null default 'individual' check(vendor_type in ('individual','company')),
  vat_registered boolean not null default false,
  bank_name text,
  bank_account_name text,
  bank_account_last4 text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contractor_contracts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractor_vendors(id) on delete restrict,
  site_id uuid not null references public.project_sites(id) on delete restrict,
  contract_number text not null unique,
  title text not null,
  pricing_model text not null check(pricing_model in ('daily','quantity','lump_sum')),
  unit_name text,
  unit_rate numeric(14,2) check(unit_rate is null or unit_rate>=0),
  contract_amount numeric(14,2) not null default 0 check(contract_amount>=0),
  retention_percent numeric(6,3) not null default 0 check(retention_percent between 0 and 100),
  withholding_percent numeric(6,3) not null default 3 check(withholding_percent between 0 and 100),
  vat_percent numeric(6,3) not null default 0 check(vat_percent between 0 and 100),
  advance_amount numeric(14,2) not null default 0 check(advance_amount>=0),
  starts_on date not null,
  ends_on date,
  status text not null default 'draft'
    check(status in ('draft','active','paused','completed','terminated','closed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=starts_on)
);

create table if not exists public.contractor_payment_claims (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contractor_contracts(id) on delete restrict,
  claim_number text not null,
  period_starts_on date not null,
  period_ends_on date not null,
  description text not null,
  quantity numeric(14,3),
  progress_percent numeric(6,3) check(progress_percent is null or progress_percent between 0 and 100),
  gross_amount numeric(14,2) not null check(gross_amount>=0),
  retention_amount numeric(14,2) not null default 0 check(retention_amount>=0),
  withholding_amount numeric(14,2) not null default 0 check(withholding_amount>=0),
  vat_amount numeric(14,2) not null default 0 check(vat_amount>=0),
  advance_deduction numeric(14,2) not null default 0 check(advance_deduction>=0),
  other_deduction numeric(14,2) not null default 0 check(other_deduction>=0),
  net_amount numeric(14,2) generated always as (
    gross_amount+vat_amount-retention_amount-withholding_amount-advance_deduction-other_deduction
  ) stored,
  evidence_path text,
  status text not null default 'submitted'
    check(status in ('draft','submitted','needs_revision','approved','pending_payment','paid','rejected','void')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  payment_reference text,
  paid_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contract_id,claim_number),
  check(period_ends_on>=period_starts_on)
);

alter table public.contractor_vendors enable row level security;
alter table public.contractor_contracts enable row level security;
alter table public.contractor_payment_claims enable row level security;
create policy "Managers manage contractor vendors" on public.contractor_vendors
  for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage contractor contracts" on public.contractor_contracts
  for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage contractor claims" on public.contractor_payment_claims
  for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());

create or replace function public.transition_contractor_claim(
  target_claim_id uuid,target_action text,target_payment_reference text default null,target_note text default null
) returns public.contractor_payment_claims
language plpgsql security definer set search_path=public as $$
declare claim public.contractor_payment_claims;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into claim from public.contractor_payment_claims where id=target_claim_id for update;
  if not found then raise exception 'Claim not found'; end if;
  if target_action='approve' and claim.status in ('submitted','needs_revision') then
    claim.status:='approved'; claim.approved_by:=auth.uid(); claim.approved_at:=now();
  elsif target_action='send_to_payment' and claim.status='approved' then
    claim.status:='pending_payment';
  elsif target_action='mark_paid' and claim.status='pending_payment' and nullif(trim(target_payment_reference),'') is not null then
    claim.status:='paid'; claim.payment_reference:=trim(target_payment_reference); claim.paid_at:=now();
  elsif target_action='reject' and claim.status in ('submitted','needs_revision') and nullif(trim(target_note),'') is not null then
    claim.status:='rejected';
  else raise exception 'Invalid claim transition';
  end if;
  update public.contractor_payment_claims set status=claim.status,approved_by=claim.approved_by,
    approved_at=claim.approved_at,payment_reference=claim.payment_reference,paid_at=claim.paid_at,updated_at=now()
  where id=claim.id returning * into claim;
  return claim;
end;
$$;
grant execute on function public.transition_contractor_claim(uuid,text,text,text) to authenticated;
