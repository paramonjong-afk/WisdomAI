-- Central effective-workday override metadata. Raw attendance evidence is immutable.

alter table public.employee_wage_day_overrides
  add column if not exists override_mode text not null default 'auto'
    check (override_mode in ('auto','full_day','half_morning','half_afternoon','custom_period','wage_only')),
  add column if not exists effective_start_time time,
  add column if not exists effective_end_time time;

alter table public.employee_wage_day_override_audits
  add column if not exists old_override_mode text,
  add column if not exists new_override_mode text,
  add column if not exists old_effective_start_time time,
  add column if not exists new_effective_start_time time,
  add column if not exists old_effective_end_time time,
  add column if not exists new_effective_end_time time;

drop function if exists public.admin_set_employee_wage_day_override(uuid,date,numeric,text);
create function public.admin_set_employee_wage_day_override(
  target_profile_id uuid,
  target_work_date date,
  target_day_units numeric,
  target_override_mode text,
  target_effective_start_time time,
  target_effective_end_time time,
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
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'Permission denied'; end if;
  if target_day_units not in (0,0.5,1) then raise exception 'Day units must be 0, 0.5, or 1'; end if;
  if target_override_mode not in ('auto','full_day','half_morning','half_afternoon','custom_period','wage_only') then raise exception 'Invalid override mode'; end if;
  if target_override_mode='custom_period' and (target_effective_start_time is null or target_effective_end_time is null or target_effective_end_time<=target_effective_start_time) then raise exception 'Valid custom period is required'; end if;
  if char_length(trim(coalesce(override_reason,'')))<3 then raise exception 'Reason is required'; end if;
  if not exists(select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=target_profile_id and m.active and (m.ends_on is null or m.ends_on>=target_work_date)) then raise exception 'Employee is not active in the current company'; end if;

  select * into before_row from public.employee_wage_day_overrides where company_id=target_company_id and profile_id=target_profile_id and work_date=target_work_date for update;
  audit_action:=case when found then 'update' else 'create' end;
  insert into public.employee_wage_day_overrides(company_id,profile_id,work_date,day_units,override_mode,effective_start_time,effective_end_time,reason,created_by,updated_by)
  values(target_company_id,target_profile_id,target_work_date,target_day_units,target_override_mode,target_effective_start_time,target_effective_end_time,trim(override_reason),auth.uid(),auth.uid())
  on conflict(company_id,profile_id,work_date) do update set day_units=excluded.day_units,override_mode=excluded.override_mode,effective_start_time=excluded.effective_start_time,effective_end_time=excluded.effective_end_time,reason=excluded.reason,updated_by=auth.uid(),updated_at=now()
  returning * into after_row;
  insert into public.employee_wage_day_override_audits(override_id,company_id,profile_id,work_date,actor_profile_id,action,reason,old_day_units,new_day_units,old_override_mode,new_override_mode,old_effective_start_time,new_effective_start_time,old_effective_end_time,new_effective_end_time)
  values(after_row.id,target_company_id,target_profile_id,target_work_date,auth.uid(),audit_action,trim(override_reason),before_row.day_units,after_row.day_units,before_row.override_mode,after_row.override_mode,before_row.effective_start_time,after_row.effective_start_time,before_row.effective_end_time,after_row.effective_end_time);
  return after_row;
end;
$$;
revoke all on function public.admin_set_employee_wage_day_override(uuid,date,numeric,text,time,time,text) from public;
grant execute on function public.admin_set_employee_wage_day_override(uuid,date,numeric,text,time,time,text) to authenticated;

comment on column public.employee_wage_day_overrides.override_mode is 'Defines the effective time boundary used by every report/payroll-facing calculation; raw attendance remains unchanged.';
