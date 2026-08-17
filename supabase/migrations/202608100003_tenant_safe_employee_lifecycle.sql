-- Keep employee lifecycle actions inside the caller's active company.

create or replace function public.employee_delete_preview(target_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  target_company_id uuid:=public.current_company_id();
  result jsonb;
  has_other_companies boolean;
  has_any_history boolean;
begin
  if target_company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;
  if not exists(
    select 1 from public.company_members m
    where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active
      and m.company_role in ('company_admin','executive')
      and (m.ends_on is null or m.ends_on>=current_date)
  ) then raise exception 'Company admin permission required'; end if;
  if target_profile_id=auth.uid() then raise exception 'ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่'; end if;
  if not exists(
    select 1 from public.company_members m
    where m.company_id=target_company_id and m.profile_id=target_profile_id
  ) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;

  select exists(
    select 1 from public.company_members m
    where m.profile_id=target_profile_id and m.company_id<>target_company_id
  ) into has_other_companies;

  select exists(select 1 from public.attendance_sessions where profile_id=target_profile_id)
    or exists(select 1 from public.employee_leave_requests where profile_id=target_profile_id)
    or exists(select 1 from public.employee_overtime_assignments where profile_id=target_profile_id)
    or exists(select 1 from public.employee_payrolls where profile_id=target_profile_id)
    or exists(select 1 from public.employee_document_requests where profile_id=target_profile_id)
  into has_any_history;

  select jsonb_build_object(
    'attendance', (select count(*) from public.attendance_sessions where profile_id=target_profile_id and company_id=target_company_id),
    'leave_requests', (select count(*) from public.employee_leave_requests where profile_id=target_profile_id and company_id=target_company_id),
    'overtime', (select count(*) from public.employee_overtime_assignments where profile_id=target_profile_id and company_id=target_company_id),
    'payrolls', (select count(*) from public.employee_payrolls where profile_id=target_profile_id and company_id=target_company_id),
    'documents', (select count(*) from public.employee_document_requests where profile_id=target_profile_id and company_id=target_company_id),
    'site_assignments', (select count(*) from public.employee_site_assignments where profile_id=target_profile_id and company_id=target_company_id),
    'has_other_companies', has_other_companies,
    'can_delete', not has_other_companies and not has_any_history
  ) into result;
  return result;
end;
$$;
revoke all on function public.employee_delete_preview(uuid) from public,anon;
grant execute on function public.employee_delete_preview(uuid) to authenticated;

create or replace function public.set_employee_active(target_profile_id uuid, make_active boolean, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare
  target_company_id uuid:=public.current_company_id();
  before_row public.employee_employment_records;
begin
  if target_company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;
  if not exists(
    select 1 from public.company_members m
    where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active
      and m.company_role in ('company_admin','executive')
      and (m.ends_on is null or m.ends_on>=current_date)
  ) then raise exception 'Company admin permission required'; end if;
  if nullif(trim(reason),'') is null then raise exception 'กรุณาระบุเหตุผล'; end if;
  if target_profile_id=auth.uid() and not make_active then raise exception 'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่'; end if;
  if not exists(
    select 1 from public.company_members m
    where m.company_id=target_company_id and m.profile_id=target_profile_id
  ) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;

  select * into before_row from public.employee_employment_records
  where profile_id=target_profile_id and company_id=target_company_id for update;
  if not found then raise exception 'ไม่พบข้อมูลการจ้างงานในบริษัทปัจจุบัน'; end if;

  update public.employee_employment_records set
    employment_status=case when make_active then 'active' else 'archived' end,
    terminated_on=case when make_active then null else coalesce(terminated_on,current_date) end,
    updated_at=now()
  where profile_id=target_profile_id and company_id=target_company_id;
  update public.employee_site_assignments set active=make_active
  where profile_id=target_profile_id and company_id=target_company_id;
  update public.company_members set active=make_active,updated_at=now()
  where profile_id=target_profile_id and company_id=target_company_id;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values
  ) values(
    target_company_id,target_profile_id,auth.uid(),'employee',target_profile_id,
    case when make_active then 'reactivate' else 'archive' end,trim(reason),to_jsonb(before_row),
    (select to_jsonb(e) from public.employee_employment_records e
      where e.profile_id=target_profile_id and e.company_id=target_company_id)
  );
end;
$$;
revoke all on function public.set_employee_active(uuid,boolean,text) from public,anon;
grant execute on function public.set_employee_active(uuid,boolean,text) to authenticated;

