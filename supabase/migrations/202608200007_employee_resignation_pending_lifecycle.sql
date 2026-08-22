alter table public.employee_employment_records
  add column if not exists resignation_notified_on date,
  add column if not exists last_working_on date,
  add column if not exists status_effective_on date,
  add column if not exists resignation_status text not null default 'none'
    check (resignation_status in ('none','pending','effective','cancelled')),
  add column if not exists payroll_eligible_until date;

create index if not exists employee_employment_resignation_status_idx
  on public.employee_employment_records(company_id,resignation_status,status_effective_on);

create or replace function public.resign_employee(
  target_profile_id uuid,
  reason text,
  target_last_working_on date default current_date,
  target_status_effective_on date default null,
  target_payroll_eligible_until date default null
)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_company_id uuid:=public.current_company_id();
  actor_role text;
  actor_is_platform_admin boolean:=false;
  before_row public.employee_employment_records;
  after_row public.employee_employment_records;
  access_ends_on date;
  next_status text;
begin
  if target_company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;

  select p.role='admin' into actor_is_platform_admin from public.profiles p where p.id=auth.uid();
  select m.company_role into actor_role
  from public.company_members m
  where m.company_id=target_company_id and m.profile_id=auth.uid()
    and m.active and (m.ends_on is null or m.ends_on>=current_date)
  limit 1;
  if not actor_is_platform_admin and coalesce(actor_role,'') not in ('company_admin','executive','site_supervisor') then
    raise exception 'Company admin permission required';
  end if;
  if nullif(trim(reason),'') is null then raise exception 'กรุณาระบุเหตุผล'; end if;
  if target_profile_id=auth.uid() then raise exception 'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่'; end if;
  if target_last_working_on is null then raise exception 'กรุณาระบุวันสุดท้ายทำงาน'; end if;

  access_ends_on:=coalesce(target_status_effective_on,target_last_working_on+1);
  if access_ends_on < target_last_working_on then raise exception 'วันที่ตัดสิทธิ์ต้องไม่ก่อนวันสุดท้ายทำงาน'; end if;
  if target_payroll_eligible_until is null then target_payroll_eligible_until:=target_last_working_on; end if;
  if target_payroll_eligible_until > target_last_working_on then raise exception 'วันคิดเงินถึงต้องไม่เกินวันสุดท้ายทำงาน'; end if;

  if not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=target_profile_id) then
    raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน';
  end if;

  select * into before_row
  from public.employee_employment_records
  where company_id=target_company_id and profile_id=target_profile_id
  for update;
  if not found then raise exception 'ไม่พบข้อมูลการจ้างงานในบริษัทปัจจุบัน'; end if;

  next_status:=case when access_ends_on<=current_date then 'effective' else 'pending' end;

  update public.employee_employment_records
  set employment_status=case when next_status='effective' then 'terminated' else 'notice' end,
      resignation_status=next_status,
      resignation_notified_on=current_date,
      last_working_on=target_last_working_on,
      status_effective_on=access_ends_on,
      payroll_eligible_until=target_payroll_eligible_until,
      terminated_on=case when next_status='effective' then target_last_working_on else null end,
      updated_at=now()
  where company_id=target_company_id and profile_id=target_profile_id
  returning * into after_row;

  update public.employee_site_assignments
  set ends_on=target_last_working_on,
      active=target_last_working_on>=current_date,
      status=case when target_last_working_on>=current_date then status else 'ended' end,
      is_primary=case when target_last_working_on>=current_date then is_primary else false end,
      change_reason=trim(reason),
      ended_by=auth.uid(),
      ended_at=case when target_last_working_on<current_date then now() else ended_at end,
      updated_at=now()
  where company_id=target_company_id and profile_id=target_profile_id and active;

  update public.company_members
  set ends_on=target_last_working_on,
      active=target_last_working_on>=current_date,
      updated_at=now()
  where company_id=target_company_id and profile_id=target_profile_id;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values
  ) values(
    target_company_id,target_profile_id,auth.uid(),'employee',target_profile_id,'resign',trim(reason),to_jsonb(before_row),to_jsonb(after_row)
  );
end $$;

revoke all on function public.resign_employee(uuid,text,date,date,date) from public,anon;
grant execute on function public.resign_employee(uuid,text,date,date,date) to authenticated;

create or replace function public.finalize_due_employee_resignations(target_company_id uuid default null)
returns integer language plpgsql security definer set search_path=public as $$
declare
  scope_company_id uuid:=coalesce(target_company_id,public.current_company_id());
  affected integer:=0;
begin
  if scope_company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;
  if not exists(
    select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'
  ) and not public.is_company_manager(scope_company_id) then
    raise exception 'Company admin permission required';
  end if;

  update public.employee_employment_records
  set employment_status='terminated',
      resignation_status='effective',
      terminated_on=coalesce(last_working_on,status_effective_on,current_date),
      updated_at=now()
  where company_id=scope_company_id
    and resignation_status='pending'
    and status_effective_on<=current_date;
  get diagnostics affected = row_count;

  update public.company_members
  set active=false,updated_at=now()
  where company_id=scope_company_id
    and ends_on is not null
    and ends_on<current_date
    and active;

  update public.employee_site_assignments
  set active=false,status='ended',is_primary=false,updated_at=now()
  where company_id=scope_company_id
    and ends_on is not null
    and ends_on<current_date
    and active;

  return affected;
end $$;

revoke all on function public.finalize_due_employee_resignations(uuid) from public,anon;
grant execute on function public.finalize_due_employee_resignations(uuid) to authenticated;

create or replace function public.resign_employee(target_profile_id uuid, reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.resign_employee(target_profile_id, reason, current_date, current_date + 1, current_date);
end $$;

revoke all on function public.resign_employee(uuid,text) from public,anon;
grant execute on function public.resign_employee(uuid,text) to authenticated;
