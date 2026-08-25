-- Company-scoped employee phone update with validation, idempotency and workforce audit.
create or replace function public.admin_update_employee_phone(
  target_profile_id uuid,
  next_phone text,
  change_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  person public.employee_people%rowtype;
  normalized_phone text := nullif(regexp_replace(trim(coalesce(next_phone, '')), '\s+', '', 'g'), '');
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'คุณไม่มีสิทธิ์แก้ไขข้อมูลติดต่อในบริษัทนี้';
  end if;
  if length(trim(coalesce(change_reason, ''))) < 3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if normalized_phone is not null and normalized_phone !~ '^\+?[0-9-]{8,20}$' then
    raise exception 'เบอร์โทรต้องมี 8-20 หลัก ใช้ได้เฉพาะตัวเลข เครื่องหมาย + และ -';
  end if;

  select * into person from public.employee_people
  where company_id = target_company_id and profile_id = target_profile_id
  for update;
  if person.id is null then raise exception 'ไม่พบทะเบียนพนักงานที่เชื่อมกับบัญชีนี้'; end if;
  if person.phone is not distinct from normalized_phone then
    return jsonb_build_object('status', 'unchanged', 'employee_person_id', person.id, 'phone', person.phone);
  end if;

  update public.employee_people set phone = normalized_phone, updated_at = now() where id = person.id;
  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, old_values, new_values
  ) values (
    target_company_id, target_profile_id, (select auth.uid()), 'employee_contact', person.id,
    'phone_updated', trim(change_reason), jsonb_build_object('phone', person.phone),
    jsonb_build_object('phone', normalized_phone, 'source', 'employee_drawer')
  );
  return jsonb_build_object('status', 'updated', 'employee_person_id', person.id, 'phone', normalized_phone);
end $$;

revoke all on function public.admin_update_employee_phone(uuid,text,text) from public;
revoke all on function public.admin_update_employee_phone(uuid,text,text) from anon;
grant execute on function public.admin_update_employee_phone(uuid,text,text) to authenticated;
