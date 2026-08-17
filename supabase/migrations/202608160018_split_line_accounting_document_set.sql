-- Allow a reviewer to remove an incorrectly grouped page before merging.
create or replace function public.detach_accounting_document_from_set(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_document public.accounting_documents;
  v_message public.line_messages;
  v_new_set uuid;
  v_remaining integer;
begin
  select * into v_document from public.accounting_documents where id=p_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(v_document.company_id) then raise exception 'permission_denied'; end if;
  if v_document.document_set_id is null then raise exception 'document_has_no_set'; end if;
  if v_document.status not in ('pending','needs_correction') then raise exception 'document_is_locked'; end if;
  select * into v_message from public.line_messages where id=v_document.source_message_id;

  insert into public.accounting_document_sets(company_id,line_group_id,line_user_id,first_received_at,last_received_at,page_count,status)
  values(v_document.company_id,v_message.line_group_id,v_message.line_user_id,v_message.occurred_at,v_message.occurred_at,1,'collecting')
  returning id into v_new_set;
  update public.accounting_documents set document_set_id=v_new_set,page_number=1,updated_at=now() where id=p_document_id;

  select count(*) into v_remaining from public.accounting_documents
  where document_set_id=v_document.document_set_id and status not in ('dismissed','duplicate');
  update public.accounting_document_sets set page_count=greatest(v_remaining,1),
    status=case when v_remaining>1 then 'needs_review' else 'collecting' end,updated_at=now()
  where id=v_document.document_set_id;
  return jsonb_build_object('document_id',p_document_id,'new_set_id',v_new_set,'remaining_pages',v_remaining);
end $$;
grant execute on function public.detach_accounting_document_from_set(uuid) to authenticated;
