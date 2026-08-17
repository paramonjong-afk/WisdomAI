-- Employee master records exist independently from application login accounts.
-- A login profile may be linked later without changing the employee identity.

create table if not exists public.employee_people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  source_intake_id uuid references public.employee_intakes(id) on delete set null,
  employee_code text not null,
  full_name text not null,
  phone text,
  employment_type text not null check (employment_type in ('daily','monthly','temporary','contractor')),
  position text,
  start_date date,
  employee_status text not null default 'preboarding' check (employee_status in ('preboarding','active','inactive','archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,employee_code),
  unique(company_id,source_intake_id)
);

create index if not exists employee_people_company_status_idx
  on public.employee_people(company_id,employee_status,created_at desc);

alter table public.employee_people enable row level security;

drop policy if exists "Tenant managers read employee people" on public.employee_people;
create policy "Tenant managers read employee people" on public.employee_people
for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

drop policy if exists "Tenant managers manage employee people" on public.employee_people;
create policy "Tenant managers manage employee people" on public.employee_people
for all to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
) with check (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

create or replace function public.approve_employee_intake(
  target_intake_id uuid,
  actor_profile_id uuid
) returns table(employee_id uuid, employee_code text, result_status text)
language plpgsql security definer set search_path=public as $$
declare
  intake public.employee_intakes;
  person public.employee_people;
  code text;
  actor_allowed boolean;
begin
  select exists(
    select 1 from public.profiles p where p.id=actor_profile_id and p.role='admin'
  ) or exists(
    select 1 from public.company_members m
    where m.profile_id=actor_profile_id and m.company_id=(select i.company_id from public.employee_intakes i where i.id=target_intake_id)
      and m.active and (m.ends_on is null or m.ends_on>=current_date)
      and m.company_role in ('company_admin','executive','manager')
  ) into actor_allowed;
  if not actor_allowed then raise exception 'employee_intake_approval_denied'; end if;

  select * into intake from public.employee_intakes
  where id=target_intake_id for update;
  if intake.id is null then raise exception 'employee_intake_not_found'; end if;

  select * into person from public.employee_people
  where company_id=intake.company_id and source_intake_id=intake.id;
  if person.id is not null then
    return query select person.id,person.employee_code,'already_created'::text;
    return;
  end if;
  if intake.status<>'pending_review' or cardinality(intake.missing_fields)>0 then
    raise exception 'employee_intake_not_ready';
  end if;

  code:='EMP-'||upper(left(replace(intake.id::text,'-',''),8));
  insert into public.employee_people(
    company_id,source_intake_id,employee_code,full_name,phone,employment_type,
    position,start_date,created_by
  ) values(
    intake.company_id,intake.id,code,intake.candidate_name,
    nullif(intake.extracted_data->>'phone',''),
    coalesce(nullif(intake.extracted_data->>'employment_type',''),'daily'),
    nullif(intake.extracted_data->>'position',''),
    nullif(intake.extracted_data->>'start_date','')::date,
    actor_profile_id
  ) returning * into person;

  update public.employee_intakes set
    status='approved',reviewed_by=actor_profile_id,reviewed_at=now(),updated_at=now()
  where id=intake.id;

  return query select person.id,person.employee_code,'created'::text;
end;
$$;

revoke all on function public.approve_employee_intake(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_employee_intake(uuid,uuid) to service_role;

comment on table public.employee_people is
  'Tenant-scoped employee master independent from authentication; profile_id is linked only when a login is issued.';

update public.system_work_items set
  status='review',progress=95,current_step='awaiting_employee_master_migration_approval',
  production_status='migration_ready_for_production',
  detail='เพิ่ม Employee Master ที่ไม่บังคับ Login, อนุมัติจาก Telegram แบบ idempotent และเชื่อม Intake หนึ่งครั้ง',
  evidence='Prepared migration 202608110031; no auth account or application permission is created.',
  worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
where work_key='EMP-LINE-ONBOARD-001';
