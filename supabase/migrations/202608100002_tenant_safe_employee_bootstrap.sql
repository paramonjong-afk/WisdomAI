-- Profile creation can run under service role before a company membership
-- exists. Never create an employment row without a tenant.
create or replace function public.bootstrap_employee_employment_record()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare target_company_id uuid;
begin
  target_company_id := public.current_company_id();
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
  ) on conflict(profile_id) do nothing;
  return new;
end;
$$;

revoke all on function public.bootstrap_employee_employment_record() from public, anon, authenticated;
