-- Two-stage employee onboarding:
-- 1) create a non-operational Employee Master in preboarding while HR fields are incomplete;
-- 2) approve the Intake only after every required field is complete.

alter table public.employee_people drop constraint if exists employee_people_employment_type_check;
alter table public.employee_people add constraint employee_people_employment_type_check
  check (employment_type in ('unknown','daily','monthly','temporary','contractor'));

create or replace function public.create_employee_preboarding_from_intake(
  target_intake_id uuid,
  actor_profile_id uuid
) returns table(
  employee_id uuid,
  employee_code text,
  result_status text,
  remaining_fields text[],
  linked_document_count integer
)
language plpgsql security definer set search_path=public as $$
declare
  intake public.employee_intakes;
  person public.employee_people;
  code text;
  actor_allowed boolean;
  linked_count integer := 0;
  was_created boolean := false;
begin
  select exists(
    select 1 from public.profiles p where p.id=actor_profile_id and p.role='admin'
  ) or exists(
    select 1 from public.company_members m
    where m.profile_id=actor_profile_id
      and m.company_id=(select i.company_id from public.employee_intakes i where i.id=target_intake_id)
      and m.active and (m.ends_on is null or m.ends_on>=current_date)
      and m.company_role in ('company_admin','executive','manager')
  ) into actor_allowed;
  if not actor_allowed then raise exception 'employee_intake_approval_denied'; end if;

  select * into intake from public.employee_intakes where id=target_intake_id for update;
  if intake.id is null then raise exception 'employee_intake_not_found'; end if;
  if intake.status in ('approved','cancelled','rejected') then raise exception 'employee_intake_preboarding_not_actionable'; end if;
  if nullif(btrim(coalesce(intake.candidate_name,'')),'') is null then raise exception 'employee_intake_candidate_name_required'; end if;
  if not exists(select 1 from public.employee_intake_documents d where d.intake_id=intake.id and d.company_id=intake.company_id) then
    raise exception 'employee_intake_document_required';
  end if;

  select * into person from public.employee_people
  where company_id=intake.company_id and source_intake_id=intake.id for update;

  if person.id is null then
    code:='EMP-'||upper(left(replace(intake.id::text,'-',''),8));
    insert into public.employee_people(
      company_id,source_intake_id,employee_code,full_name,phone,employment_type,
      position,start_date,employee_status,created_by
    ) values(
      intake.company_id,intake.id,code,btrim(intake.candidate_name),
      nullif(btrim(intake.extracted_data->>'phone'),''),
      case when intake.extracted_data->>'employment_type' in ('daily','monthly','temporary','contractor')
        then intake.extracted_data->>'employment_type' else 'unknown' end,
      nullif(btrim(intake.extracted_data->>'position'),''),
      case when coalesce(intake.extracted_data->>'start_date','') ~ '^\d{4}-\d{2}-\d{2}$'
        then (intake.extracted_data->>'start_date')::date else null end,
      'preboarding',actor_profile_id
    ) returning * into person;
    was_created:=true;
  else
    update public.employee_people set
      full_name=coalesce(nullif(btrim(intake.candidate_name),''),full_name),
      phone=coalesce(nullif(btrim(intake.extracted_data->>'phone'),''),phone),
      employment_type=case when intake.extracted_data->>'employment_type' in ('daily','monthly','temporary','contractor')
        then intake.extracted_data->>'employment_type' else employment_type end,
      position=coalesce(nullif(btrim(intake.extracted_data->>'position'),''),position),
      start_date=coalesce(case when coalesce(intake.extracted_data->>'start_date','') ~ '^\d{4}-\d{2}-\d{2}$'
        then (intake.extracted_data->>'start_date')::date else null end,start_date),
      updated_at=now()
    where id=person.id returning * into person;
  end if;

  linked_count:=public.sync_employee_intake_person_documents(intake.id,person.id,actor_profile_id);

  update public.employee_intakes set
    purpose='new_employee',
    status=case when cardinality(missing_fields)>0 then 'information_required' else 'pending_review' end,
    submitted_at=case when cardinality(missing_fields)=0 then coalesce(submitted_at,now()) else null end,
    updated_at=now()
  where id=intake.id;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values
  ) values(
    intake.company_id,person.profile_id,actor_profile_id,'employee_person',person.id,
    case when was_created then 'employee_preboarding_created' else 'employee_preboarding_reused' end,
    'สร้าง/ยืนยันประวัติพนักงานเบื้องต้นจาก HR Intake โดยยังไม่เปิด Login ลงเวลา หรือค่าแรง',
    jsonb_build_object('intake_id',intake.id,'employee_code',person.employee_code,'remaining_fields',intake.missing_fields,'newly_linked_document_count',linked_count)
  );

  return query select person.id,person.employee_code,
    case when was_created then 'preboarding_created' else 'preboarding_reused' end,
    intake.missing_fields,linked_count;
end;
$$;

revoke all on function public.create_employee_preboarding_from_intake(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_employee_preboarding_from_intake(uuid,uuid) to service_role;

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
  linked_count integer := 0;
begin
  select exists(
    select 1 from public.profiles p where p.id=actor_profile_id and p.role='admin'
  ) or exists(
    select 1 from public.company_members m
    where m.profile_id=actor_profile_id
      and m.company_id=(select i.company_id from public.employee_intakes i where i.id=target_intake_id)
      and m.active and (m.ends_on is null or m.ends_on>=current_date)
      and m.company_role in ('company_admin','executive','manager')
  ) into actor_allowed;
  if not actor_allowed then raise exception 'employee_intake_approval_denied'; end if;

  select * into intake from public.employee_intakes where id=target_intake_id for update;
  if intake.id is null then raise exception 'employee_intake_not_found'; end if;

  select * into person from public.employee_people
  where company_id=intake.company_id and source_intake_id=intake.id for update;
  if intake.status='approved' and person.id is not null then
    return query select person.id,person.employee_code,'already_approved'::text;
    return;
  end if;
  if intake.status<>'pending_review' or cardinality(intake.missing_fields)>0 then raise exception 'employee_intake_not_ready'; end if;
  if nullif(btrim(coalesce(intake.candidate_name,'')),'') is null then raise exception 'employee_intake_candidate_name_required'; end if;
  if intake.extracted_data->>'employment_type' not in ('daily','monthly','temporary','contractor') then raise exception 'employee_intake_employment_type_invalid'; end if;

  if person.id is null then
    code:='EMP-'||upper(left(replace(intake.id::text,'-',''),8));
    insert into public.employee_people(
      company_id,source_intake_id,employee_code,full_name,phone,employment_type,
      position,start_date,employee_status,created_by
    ) values(
      intake.company_id,intake.id,code,btrim(intake.candidate_name),
      nullif(btrim(intake.extracted_data->>'phone'),''),intake.extracted_data->>'employment_type',
      nullif(btrim(intake.extracted_data->>'position'),''),(intake.extracted_data->>'start_date')::date,
      'preboarding',actor_profile_id
    ) returning * into person;
  else
    update public.employee_people set
      full_name=btrim(intake.candidate_name),phone=nullif(btrim(intake.extracted_data->>'phone'),''),
      employment_type=intake.extracted_data->>'employment_type',position=nullif(btrim(intake.extracted_data->>'position'),''),
      start_date=(intake.extracted_data->>'start_date')::date,employee_status='preboarding',updated_at=now()
    where id=person.id returning * into person;
  end if;

  linked_count:=public.sync_employee_intake_person_documents(intake.id,person.id,actor_profile_id);
  update public.employee_intakes set status='approved',reviewed_by=actor_profile_id,reviewed_at=now(),updated_at=now() where id=intake.id;
  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values
  ) values(
    intake.company_id,person.profile_id,actor_profile_id,'employee_person',person.id,'employee_intake_approved',
    'ข้อมูล HR Intake ครบและอนุมัติส่งเข้า Onboarding; ยังไม่เปิด Login ลงเวลา หรือค่าแรง',
    jsonb_build_object('intake_id',intake.id,'employee_code',person.employee_code,'newly_linked_document_count',linked_count)
  );
  return query select person.id,person.employee_code,
    case when linked_count>0 then 'approved_and_documents_linked' else 'approved' end;
end;
$$;

revoke all on function public.approve_employee_intake(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_employee_intake(uuid,uuid) to service_role;

comment on function public.create_employee_preboarding_from_intake(uuid,uuid) is
  'Idempotently creates a non-operational Employee Master from an incomplete HR Intake, links every document, preserves missing fields, and writes audit.';
