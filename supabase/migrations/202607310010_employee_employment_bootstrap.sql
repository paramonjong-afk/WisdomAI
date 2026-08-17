-- Every authenticated employee must have an employment state before clocking.

insert into public.employee_employment_records(
  profile_id,employee_code,employment_type,employment_status,daily_rate,monthly_salary,overtime_hourly_rate
)
select profile.id,'EMP-'||upper(left(replace(profile.id::text,'-',''),8)),
  coalesce(profile.employment_type,'daily'),'preboarding',
  coalesce(profile.daily_rate,0),coalesce(profile.monthly_salary,0),coalesce(profile.ot_hourly_rate,0)
from public.profiles profile
where not exists(
  select 1 from public.employee_employment_records employment where employment.profile_id=profile.id
)
on conflict(profile_id) do nothing;

create or replace function public.bootstrap_employee_employment_record()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.employee_employment_records(
    profile_id,employee_code,employment_type,employment_status,daily_rate,monthly_salary,overtime_hourly_rate
  ) values(
    new.id,'EMP-'||upper(left(replace(new.id::text,'-',''),8)),
    coalesce(new.employment_type,'daily'),'preboarding',
    coalesce(new.daily_rate,0),coalesce(new.monthly_salary,0),coalesce(new.ot_hourly_rate,0)
  ) on conflict(profile_id) do nothing;
  return new;
end;
$$;
drop trigger if exists bootstrap_employee_employment_after_profile on public.profiles;
create trigger bootstrap_employee_employment_after_profile
after insert on public.profiles for each row execute function public.bootstrap_employee_employment_record();
