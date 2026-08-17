-- A quotation must identify its project, but remains non-posting reference data.
create or replace function public.process_quotation_decision_with_project(
  p_document_id uuid,p_action text,p_lines jsonb default '[]'::jsonb,p_reason text default null,p_valid_until date default null,p_project_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;result jsonb;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found';end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if p_project_id is null then raise exception 'quotation_project_required';end if;
  if not exists(select 1 from public.projects where id=p_project_id and company_id=doc.company_id) then raise exception 'project_not_in_company';end if;
  update public.accounting_documents set project_id=p_project_id,posting_status='not_posted',updated_at=now() where id=doc.id;
  result:=public.process_quotation_decision(p_document_id,p_action,p_lines,p_reason,p_valid_until,p_project_id);
  update public.accounting_documents set posting_status='not_posted',updated_at=now() where id=doc.id;
  update public.quotation_price_references set project_id=p_project_id,updated_at=now() where document_id=doc.id;
  return result||jsonb_build_object('project_id',p_project_id,'accounting_posted',false,'cost_recognized',false);
end;$$;
grant execute on function public.process_quotation_decision_with_project(uuid,text,jsonb,text,date,uuid) to authenticated;
comment on function public.process_quotation_decision_with_project(uuid,text,jsonb,text,date,uuid) is 'Requires project attribution while keeping quotation values non-posting and outside actual project cost.';
notify pgrst,'reload schema';
