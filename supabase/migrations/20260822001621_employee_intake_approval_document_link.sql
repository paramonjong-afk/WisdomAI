-- Keep the HR Intake decision, Employee Master, and attached-document register
-- in one recoverable transaction. Files remain in their original private bucket;
-- this registry only records a secure reference to the source attachment.

create table if not exists public.employee_person_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_person_id uuid not null references public.employee_people(id) on delete cascade,
  source_intake_document_id uuid not null references public.employee_intake_documents(id) on delete restrict,
  document_type text not null check (document_type in (
    'unknown','thai_national_id','house_registration','education_certificate',
    'bank_evidence','portrait','other'
  )),
  source_channel text not null check (source_channel in ('telegram','line','web_chat')),
  storage_bucket text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 15728640),
  content_sha256 text,
  link_status text not null default 'available' check (link_status in ('available','superseded','unavailable')),
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (employee_person_id, source_intake_document_id),
  unique (company_id, storage_path)
);

create index if not exists employee_person_documents_person_idx
  on public.employee_person_documents(company_id, employee_person_id, created_at desc);

alter table public.employee_person_documents enable row level security;

drop policy if exists "Tenant managers read employee person documents" on public.employee_person_documents;
create policy "Tenant managers read employee person documents" on public.employee_person_documents
for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

drop policy if exists "Tenant managers manage employee person documents" on public.employee_person_documents;
create policy "Tenant managers manage employee person documents" on public.employee_person_documents
for all to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
) with check (
  public.is_platform_admin() or public.is_company_manager(company_id)
);

create or replace function public.sync_employee_intake_person_documents(
  target_intake_id uuid,
  target_employee_person_id uuid,
  actor_profile_id uuid default null
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  linked_count integer := 0;
begin
  insert into public.employee_person_documents (
    company_id, employee_person_id, source_intake_document_id, document_type,
    source_channel, storage_bucket, storage_path, mime_type, size_bytes,
    content_sha256, linked_by
  )
  select
    document.company_id, target_employee_person_id, document.id, document.document_type,
    document.source_channel, document.storage_bucket, document.storage_path, document.mime_type,
    document.size_bytes, document.content_sha256, actor_profile_id
  from public.employee_intake_documents document
  where document.intake_id = target_intake_id
  on conflict (employee_person_id, source_intake_document_id) do nothing;

  get diagnostics linked_count = row_count;
  return linked_count;
end;
$$;

revoke all on function public.sync_employee_intake_person_documents(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.sync_employee_intake_person_documents(uuid,uuid,uuid) to service_role;

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
  was_approved boolean := false;
  newly_linked integer := 0;
begin
  select exists(
    select 1 from public.profiles p where p.id = actor_profile_id and p.role = 'admin'
  ) or exists(
    select 1 from public.company_members m
    where m.profile_id = actor_profile_id
      and m.company_id = (select i.company_id from public.employee_intakes i where i.id = target_intake_id)
      and m.active and (m.ends_on is null or m.ends_on >= current_date)
      and m.company_role in ('company_admin','executive','manager')
  ) into actor_allowed;
  if not actor_allowed then raise exception 'employee_intake_approval_denied'; end if;

  select * into intake from public.employee_intakes where id = target_intake_id for update;
  if intake.id is null then raise exception 'employee_intake_not_found'; end if;

  select * into person from public.employee_people
  where company_id = intake.company_id and source_intake_id = intake.id;

  was_approved := intake.status = 'approved';
  if person.id is null then
    if intake.status <> 'pending_review' or cardinality(intake.missing_fields) > 0 then
      raise exception 'employee_intake_not_ready';
    end if;

    code := 'EMP-' || upper(left(replace(intake.id::text, '-', ''), 8));
    insert into public.employee_people(
      company_id, source_intake_id, employee_code, full_name, phone, employment_type,
      position, start_date, created_by
    ) values(
      intake.company_id, intake.id, code, intake.candidate_name,
      nullif(intake.extracted_data->>'phone',''),
      coalesce(nullif(intake.extracted_data->>'employment_type',''),'daily'),
      nullif(intake.extracted_data->>'position',''),
      nullif(intake.extracted_data->>'start_date','')::date,
      actor_profile_id
    ) returning * into person;
  end if;

  -- An older interrupted approval may already have created the person.  Heal the
  -- Intake state rather than returning success while leaving it pending_review.
  update public.employee_intakes set
    status = 'approved',
    reviewed_by = coalesce(reviewed_by, actor_profile_id),
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
  where id = intake.id;

  newly_linked := public.sync_employee_intake_person_documents(intake.id, person.id, actor_profile_id);

  if not was_approved or newly_linked > 0 then
    insert into public.employee_workforce_audit_logs(
      company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, new_values
    ) values (
      intake.company_id, person.profile_id, actor_profile_id, 'employee_person', person.id,
      'employee_intake_approved',
      'อนุมัติ Intake HR และเชื่อมทะเบียนเอกสารพนักงาน',
      jsonb_build_object('intake_id', intake.id, 'employee_code', person.employee_code, 'newly_linked_document_count', newly_linked)
    );
  end if;

  return query select person.id, person.employee_code,
    case when was_approved then 'already_approved' when newly_linked > 0 then 'approved_and_documents_linked' else 'approved' end;
end;
$$;

revoke all on function public.approve_employee_intake(uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_employee_intake(uuid,uuid) to service_role;

-- Repair legacy partial approvals in place. It neither creates a second employee
-- nor copies the binary files; it only aligns Intake status and links source docs.
do $$
declare
  record_row record;
  linked_count integer;
begin
  for record_row in
    select person.id as person_id, person.profile_id, person.employee_code, intake.id as intake_id, intake.company_id
    from public.employee_people person
    join public.employee_intakes intake on intake.id = person.source_intake_id
    where intake.status <> 'approved'
  loop
    update public.employee_intakes
    set status = 'approved', reviewed_at = coalesce(reviewed_at, now()), updated_at = now()
    where id = record_row.intake_id;

    linked_count := public.sync_employee_intake_person_documents(record_row.intake_id, record_row.person_id, null);
    insert into public.employee_workforce_audit_logs(
      company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, new_values
    ) values (
      record_row.company_id, record_row.profile_id, null, 'employee_person', record_row.person_id,
      'employee_intake_reconciled',
      'ซ่อมสถานะ Intake ที่เคยสร้างทะเบียนพนักงานแล้วแต่ยังค้าง',
      jsonb_build_object('intake_id', record_row.intake_id, 'employee_code', record_row.employee_code, 'newly_linked_document_count', linked_count)
    );
  end loop;
end;
$$;

comment on table public.employee_person_documents is
  'Secure employee-master document registry. References approved HR Intake files without copying binaries or exposing them outside company-manager access.';
