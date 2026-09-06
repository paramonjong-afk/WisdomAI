-- Allow company managers to add a phone to legacy employees that have a Profile
-- and employment record but no employee_people projection yet.

create unique index if not exists employee_people_company_profile_uidx
  on public.employee_people(company_id, profile_id)
  where profile_id is not null;

create or replace function public.admin_update_employee_phone(
  target_profile_id uuid,
  next_phone text,
  change_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  person public.employee_people%rowtype;
  target_profile public.profiles%rowtype;
  employment public.employee_employment_records%rowtype;
  normalized_phone text := nullif(regexp_replace(trim(coalesce(next_phone, '')), '\s+', '', 'g'), '');
  resolved_employee_code text;
  projection_created boolean := false;
  prior_phone text;
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'คุณไม่มีสิทธิ์แก้ไขข้อมูลติดต่อในบริษัทนี้';
  end if;
  if length(trim(coalesce(change_reason, ''))) < 3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if normalized_phone is not null and normalized_phone !~ '^\+?[0-9-]{8,20}$' then
    raise exception 'เบอร์โทรต้องมี 8-20 หลัก ใช้ได้เฉพาะตัวเลข เครื่องหมาย + และ -';
  end if;

  select p.* into target_profile
  from public.profiles p
  join public.company_members member on member.profile_id = p.id
  where p.id = target_profile_id
    and member.company_id = target_company_id
    and member.active = true;
  if target_profile.id is null then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;

  select * into employment
  from public.employee_employment_records record
  where record.company_id = target_company_id and record.profile_id = target_profile_id;

  select * into person from public.employee_people
  where company_id = target_company_id and profile_id = target_profile_id
  for update;

  if person.id is null then
    resolved_employee_code := coalesce(
      nullif(trim(employment.employee_code), ''),
      'EMP-' || upper(substr(replace(target_profile_id::text, '-', ''), 1, 8))
    );

    select * into person from public.employee_people
    where company_id = target_company_id
      and employee_code = resolved_employee_code
      and profile_id is null
    for update;

    if person.id is not null then
      prior_phone := person.phone;
      update public.employee_people set
        profile_id = target_profile_id,
        phone = normalized_phone,
        full_name = coalesce(nullif(trim(target_profile.full_name), ''), full_name),
        employee_status = case when coalesce(employment.employment_status, 'active') in ('active', 'probation', 'notice') then 'active' else employee_status end,
        updated_at = now()
      where id = person.id returning * into person;
    else
      insert into public.employee_people(
        company_id, profile_id, employee_code, full_name, phone,
        employment_type, position, start_date, employee_status, created_by
      ) values (
        target_company_id,
        target_profile_id,
        resolved_employee_code,
        coalesce(nullif(trim(target_profile.full_name), ''), nullif(trim(target_profile.email), ''), 'พนักงาน'),
        normalized_phone,
        case when coalesce(employment.employment_type, target_profile.employment_type, 'unknown') in ('daily','monthly','temporary','contractor')
          then coalesce(employment.employment_type, target_profile.employment_type) else 'unknown' end,
        employment.job_title,
        employment.hired_on,
        case when coalesce(employment.employment_status, 'active') in ('active', 'probation', 'notice') then 'active' else 'inactive' end,
        (select auth.uid())
      ) returning * into person;
    end if;
    projection_created := true;
  elsif person.phone is not distinct from normalized_phone then
    return jsonb_build_object('status', 'unchanged', 'employee_person_id', person.id, 'phone', person.phone, 'projection_created', false);
  else
    prior_phone := person.phone;
    update public.employee_people set phone = normalized_phone, updated_at = now() where id = person.id returning * into person;
  end if;

  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, old_values, new_values
  ) values (
    target_company_id, target_profile_id, (select auth.uid()), 'employee_contact', person.id,
    case when projection_created then 'phone_contact_created' else 'phone_updated' end,
    trim(change_reason), jsonb_build_object('phone', prior_phone),
    jsonb_build_object('phone', normalized_phone, 'source', 'employee_drawer', 'projection_created', projection_created)
  );
  return jsonb_build_object('status', 'updated', 'employee_person_id', person.id, 'phone', normalized_phone, 'projection_created', projection_created);
end $$;

revoke all on function public.admin_update_employee_phone(uuid,text,text) from public;
revoke all on function public.admin_update_employee_phone(uuid,text,text) from anon;
grant execute on function public.admin_update_employee_phone(uuid,text,text) to authenticated;

-- Rollback/recovery: restore the prior RPC to require an existing employee_people
-- projection and keep any linked projection plus Workforce Audit for reconciliation.
