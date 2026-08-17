-- TEN-007: one profile may have different employment terms in each company.

alter table public.employee_employment_records
  drop constraint if exists employee_employment_records_pkey;

alter table public.employee_employment_records
  add constraint employee_employment_records_pkey primary key (company_id, profile_id);

create index if not exists employee_employment_records_profile_idx
  on public.employee_employment_records(profile_id);

create or replace function public.bootstrap_employee_employment_record()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_company_id uuid;
begin
  target_company_id:=public.current_company_id();
  if target_company_id is null then
    select m.company_id into target_company_id
    from public.company_members m
    where m.profile_id=new.id and m.active
      and (m.ends_on is null or m.ends_on>=current_date)
    order by m.created_at limit 1;
  end if;
  if target_company_id is null then return new; end if;

  insert into public.employee_employment_records(
    company_id,profile_id,employee_code,employment_type,employment_status,
    daily_rate,monthly_salary,overtime_hourly_rate
  ) values(
    target_company_id,new.id,'EMP-'||upper(left(replace(new.id::text,'-',''),8)),
    coalesce(new.employment_type,'daily'),'preboarding',
    coalesce(new.daily_rate,0),coalesce(new.monthly_salary,0),coalesce(new.ot_hourly_rate,0)
  ) on conflict(company_id,profile_id) do nothing;
  return new;
end;
$$;

update public.system_work_items set
  status='doing',progress=70,current_step='migration_and_source_update',
  production_status='migration_ready_for_production',
  evidence='TEN-007 migration changes employment identity to company_id + profile_id and preserves the profile foreign key.',
  updated_at=now()
where work_key='TEN-007';
