-- Route employee documents received from LINE to the restricted HR Intake path.
-- Raw LINE messages and attachments remain the immutable source. The employee
-- intake copy is private, idempotent, and cannot create an active employee.

alter table public.employee_intakes
  add column if not exists source_bundle_key text;

create unique index if not exists employee_intakes_source_bundle_key_uidx
  on public.employee_intakes(source_bundle_key);

alter table public.employee_intake_documents
  drop constraint if exists employee_intake_documents_document_type_check;
alter table public.employee_intake_documents
  add constraint employee_intake_documents_document_type_check check (document_type in (
    'unknown','thai_national_id','driving_license','house_registration',
    'education_certificate','bank_evidence','portrait','other'
  ));

alter table public.employee_person_documents
  drop constraint if exists employee_person_documents_document_type_check;
alter table public.employee_person_documents
  add constraint employee_person_documents_document_type_check check (document_type in (
    'unknown','thai_national_id','driving_license','house_registration',
    'education_certificate','bank_evidence','portrait','other'
  ));

alter table public.line_attachments
  drop constraint if exists line_attachments_retention_class_check;
alter table public.line_attachments
  add constraint line_attachments_retention_class_check check (
    retention_class in ('temporary','work_evidence','system_error','financial','audit','hr_restricted')
  );

insert into public.image_purpose_catalog(code,name_th,description,sort_order)
values('hr_document','เอกสารบุคคล / เอกสารพนักงาน','เอกสาร HR ที่ต้องเก็บแบบจำกัดสิทธิ์และรอ Admin ยืนยันก่อนสร้างพนักงาน',65)
on conflict(code) do update set
  name_th=excluded.name_th,
  description=excluded.description,
  sort_order=excluded.sort_order,
  active=true,
  updated_at=now();

create or replace function public.route_hr_image_review_to_intake()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  before_item public.document_flow_items;
  item public.document_flow_items;
  target_type text;
begin
  target_type := coalesce(new.confirmed_document_type, new.proposed_document_type);
  if new.proposed_primary_purpose <> 'hr_document'
     and target_type not in (
       'thai_national_id','driving_license','house_registration',
       'education_certificate','bank_evidence','portrait'
     ) then
    return new;
  end if;

  select * into before_item
  from public.document_flow_items
  where source_message_id=new.source_message_id
    and current_flow <> 'completed'
  for update;

  update public.document_flow_items
  set current_flow='intake',
      current_room='intake_hr_document_review',
      state='awaiting_classification',
      document_type=coalesce(nullif(target_type,''),'other'),
      route_target='hr_employee_document',
      sensitivity='restricted_hr',
      auto_routed=false,
      issue_codes=array['hr_admin_review_required'],
      version=version+1,
      updated_at=now()
  where source_message_id=new.source_message_id
    and current_flow <> 'completed'
  returning * into item;

  if item.id is not null then
    insert into public.document_flow_events(
      item_id,company_id,event_key,event_type,from_flow,to_flow,
      from_state,to_state,from_room,to_room,note,payload
    ) values (
      item.id,item.company_id,
      'hr-document-route:'||item.id::text||':'||item.version::text,
      'hr_document_routed',before_item.current_flow,item.current_flow,
      before_item.state,item.state,
      before_item.current_room,item.current_room,
      'เอกสารบุคคลจาก LINE รอ HR/Admin ตรวจและยืนยัน',
      jsonb_build_object(
        'source_message_id',new.source_message_id,
        'document_type',target_type,
        'review_case_id',new.id
      )
    ) on conflict(event_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_route_hr_image_review_to_intake on public.image_review_cases;
create trigger zz_route_hr_image_review_to_intake
after insert or update of proposed_primary_purpose,proposed_document_type,confirmed_document_type
on public.image_review_cases
for each row execute function public.route_hr_image_review_to_intake();

comment on column public.employee_intakes.source_bundle_key is
  'Idempotency key that groups employee documents from the same tenant, channel, sender, room, and short time window.';
