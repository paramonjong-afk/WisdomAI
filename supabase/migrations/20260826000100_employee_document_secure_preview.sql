-- Resolve a private employee document only after checking the active company
-- and manager permission. Every preview/download request is recorded before a
-- short-lived Storage URL is created by the authenticated client.
create or replace function public.request_employee_document_access(
  target_document_id uuid,
  target_action text default 'preview'
) returns table(
  document_id uuid,
  document_type text,
  link_status text,
  source_channel text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  linked_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
declare
  target_company_id uuid := public.current_company_id();
  document_row public.employee_person_documents;
  person_row public.employee_people;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if target_action not in ('preview','download') then raise exception 'employee_document_action_invalid'; end if;
  if target_company_id is null or not (public.is_platform_admin() or public.is_company_manager(target_company_id)) then
    raise exception 'employee_document_access_denied';
  end if;

  select * into document_row
  from public.employee_person_documents document
  where document.id=target_document_id and document.company_id=target_company_id;
  if document_row.id is null then raise exception 'employee_document_not_found'; end if;
  if document_row.link_status<>'available' then raise exception 'employee_document_unavailable'; end if;

  select * into person_row from public.employee_people person
  where person.id=document_row.employee_person_id and person.company_id=target_company_id;
  if person_row.id is null then raise exception 'employee_document_employee_mismatch'; end if;

  insert into public.employee_workforce_audit_logs(
    company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values
  ) values(
    target_company_id,person_row.profile_id,auth.uid(),'employee_person_document',document_row.id,
    case when target_action='download' then 'employee_document_download_requested' else 'employee_document_preview_requested' end,
    case when target_action='download' then 'ผู้มีสิทธิ์ขอดาวน์โหลดเอกสารพนักงาน' else 'ผู้มีสิทธิ์ขอเปิดดูเอกสารพนักงาน' end,
    jsonb_build_object(
      'employee_person_id',person_row.id,
      'employee_code',person_row.employee_code,
      'document_type',document_row.document_type,
      'source_channel',document_row.source_channel,
      'link_status',document_row.link_status
    )
  );

  return query select
    document_row.id,document_row.document_type,document_row.link_status,
    document_row.source_channel,document_row.storage_bucket,document_row.storage_path,
    document_row.mime_type,document_row.linked_at;
end;
$$;

revoke all on function public.request_employee_document_access(uuid,text) from public,anon;
grant execute on function public.request_employee_document_access(uuid,text) to authenticated;

comment on function public.request_employee_document_access(uuid,text) is
  'Company-manager gate for private employee document preview/download. Returns a storage reference after writing immutable workforce audit.';
