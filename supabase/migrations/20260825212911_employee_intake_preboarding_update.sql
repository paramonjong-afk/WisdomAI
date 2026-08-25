create or replace function public.update_employee_preboarding_from_intake(
  target_intake_id uuid,
  actor_profile_id uuid,
  draft jsonb
) returns table(
  employee_id uuid,
  employee_code text,
  result_status text,
  remaining_fields text[],
  ready_for_approval boolean
)
language plpgsql security definer set search_path=public as $$
declare
  intake public.employee_intakes;
  person public.employee_people;
  actor_allowed boolean;
  next_name text;
  next_phone text;
  next_type text;
  next_position text;
  next_start_date date;
  next_missing text[] := array[]::text[];
  changed_fields text[] := array[]::text[];
begin
  select * into intake from public.employee_intakes where id=target_intake_id for update;
  if intake.id is null then raise exception 'employee_intake_not_found'; end if;

  select exists(select 1 from public.profiles p where p.id=actor_profile_id and p.role='admin')
    or exists(
      select 1 from public.company_members m
      where m.profile_id=actor_profile_id and m.company_id=intake.company_id
        and m.active and (m.ends_on is null or m.ends_on>=current_date)
        and m.company_role in ('company_admin','executive','manager')
    ) into actor_allowed;
  if not actor_allowed then raise exception 'employee_intake_approval_denied'; end if;
  if intake.status in ('approved','cancelled','rejected') then raise exception 'employee_intake_preboarding_not_actionable'; end if;

  select * into person from public.employee_people
  where company_id=intake.company_id and source_intake_id=intake.id for update;
  if person.id is null or person.employee_status<>'preboarding' then
    raise exception 'employee_intake_preboarding_not_found';
  end if;

  next_name := nullif(btrim(coalesce(draft->>'full_name',person.full_name)), '');
  next_phone := nullif(regexp_replace(coalesce(draft->>'phone',person.phone,''),'\s+','','g'), '');
  next_type := coalesce(nullif(draft->>'employment_type',''),person.employment_type,'unknown');
  next_position := nullif(btrim(coalesce(draft->>'position',person.position,'')), '');
  begin
    next_start_date := nullif(coalesce(draft->>'start_date',person.start_date::text),'')::date;
  exception when invalid_datetime_format then
    raise exception 'employee_intake_start_date_invalid';
  end;

  if next_name is null then raise exception 'employee_intake_candidate_name_required'; end if;
  if next_phone is not null and next_phone !~ '^\+?[0-9-]{8,20}$' then raise exception 'employee_intake_phone_invalid'; end if;
  if next_type not in ('unknown','daily','monthly','temporary','contractor') then raise exception 'employee_intake_employment_type_invalid'; end if;

  if next_phone is null then next_missing:=array_append(next_missing,'phone'); end if;
  if next_type='unknown' then next_missing:=array_append(next_missing,'employment_type'); end if;
  if next_position is null then next_missing:=array_append(next_missing,'position'); end if;
  if next_start_date is null then next_missing:=array_append(next_missing,'start_date'); end if;

  if person.full_name is distinct from next_name then changed_fields:=array_append(changed_fields,'full_name'); end if;
  if person.phone is distinct from next_phone then changed_fields:=array_append(changed_fields,'phone'); end if;
  if person.employment_type is distinct from next_type then changed_fields:=array_append(changed_fields,'employment_type'); end if;
  if person.position is distinct from next_position then changed_fields:=array_append(changed_fields,'position'); end if;
  if person.start_date is distinct from next_start_date then changed_fields:=array_append(changed_fields,'start_date'); end if;

  update public.employee_people set full_name=next_name,phone=next_phone,employment_type=next_type,
    position=next_position,start_date=next_start_date,updated_at=now()
  where id=person.id returning * into person;

  update public.employee_intakes set candidate_name=next_name,
    extracted_data=coalesce(extracted_data,'{}'::jsonb)||jsonb_build_object(
      'phone',next_phone,'employment_type',next_type,'position',next_position,'start_date',next_start_date
    ),
    missing_fields=next_missing,
    status=case when cardinality(next_missing)=0 then 'pending_review' else 'information_required' end,
    submitted_at=case when cardinality(next_missing)=0 then coalesce(submitted_at,now()) else null end,
    updated_at=now()
  where id=intake.id;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values
  ) values(
    intake.company_id,person.profile_id,actor_profile_id,'employee_person',person.id,
    'employee_preboarding_updated','HR เพิ่ม/อัปเดตข้อมูลก่อนเริ่มงานจากคิว Onboarding',
    jsonb_build_object('intake_id',intake.id,'changed_fields',changed_fields,'remaining_fields',next_missing)
  );

  return query select person.id,person.employee_code,'preboarding_updated'::text,next_missing,cardinality(next_missing)=0;
end;
$$;

revoke all on function public.update_employee_preboarding_from_intake(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_employee_preboarding_from_intake(uuid,uuid,jsonb) to service_role;

comment on function public.update_employee_preboarding_from_intake(uuid,uuid,jsonb) is
  'Validates and updates a non-operational Employee Master draft, recomputes readiness, and writes an audit event.';
