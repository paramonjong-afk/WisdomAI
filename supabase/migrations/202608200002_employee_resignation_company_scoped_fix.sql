-- Applied to production as employee_resignation_company_scoped_fix.
-- Resignation is company-local and uses the current-company context only.
create or replace function public.resign_employee(target_profile_id uuid, reason text)
returns void language plpgsql security definer set search_path=public as $$
declare target_company_id uuid:=public.current_company_id(); before_row public.employee_employment_records;
begin
  if target_company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;
  if not exists(select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active and m.company_role in ('company_admin','executive','site_supervisor') and (m.ends_on is null or m.ends_on>=current_date)) then raise exception 'Company admin permission required'; end if;
  if nullif(trim(reason),'') is null then raise exception 'กรุณาระบุเหตุผล'; end if;
  if target_profile_id=auth.uid() then raise exception 'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่'; end if;
  if not exists(select 1 from public.company_members where company_id=target_company_id and profile_id=target_profile_id) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;
  select * into before_row from public.employee_employment_records where company_id=target_company_id and profile_id=target_profile_id for update;
  if not found then raise exception 'ไม่พบข้อมูลการจ้างงานในบริษัทปัจจุบัน'; end if;
  update public.employee_employment_records set employment_status='terminated',terminated_on=current_date,updated_at=now() where company_id=target_company_id and profile_id=target_profile_id;
  update public.employee_site_assignments set active=false,updated_at=now() where company_id=target_company_id and profile_id=target_profile_id and active;
  update public.company_members set active=false,updated_at=now() where company_id=target_company_id and profile_id=target_profile_id;
  insert into public.employee_workforce_audit_logs(company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values) values(target_company_id,target_profile_id,auth.uid(),'employee',target_profile_id,'resign',trim(reason),to_jsonb(before_row),(select to_jsonb(e) from public.employee_employment_records e where e.company_id=target_company_id and e.profile_id=target_profile_id));
end $$;
revoke all on function public.resign_employee(uuid,text) from public,anon;
grant execute on function public.resign_employee(uuid,text) to authenticated;
