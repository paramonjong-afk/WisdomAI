-- Persist incomplete accounting review work without weakening final confirmation validation.
alter table public.accounting_documents
  add column if not exists review_draft jsonb,
  add column if not exists review_draft_updated_at timestamptz,
  add column if not exists review_draft_updated_by uuid references public.profiles(id) on delete set null;

create or replace function public.save_accounting_document_review_draft(
  p_document_id uuid,
  p_draft jsonb
) returns void
language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.status not in ('pending','needs_correction') then raise exception 'document_not_editable'; end if;
  if p_draft is null or jsonb_typeof(p_draft)<>'object' then raise exception 'invalid_review_draft'; end if;
  if pg_column_size(p_draft)>1048576 then raise exception 'review_draft_too_large'; end if;

  update public.accounting_documents set
    review_draft=p_draft,review_draft_updated_at=now(),review_draft_updated_by=auth.uid(),updated_at=now()
  where id=p_document_id;
end;
$$;

create or replace function public.clear_accounting_document_review_draft(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  update public.accounting_documents set
    review_draft=null,review_draft_updated_at=null,review_draft_updated_by=null,updated_at=now()
  where id=p_document_id;
end;
$$;

grant execute on function public.save_accounting_document_review_draft(uuid,jsonb) to authenticated;
grant execute on function public.clear_accounting_document_review_draft(uuid) to authenticated;
comment on column public.accounting_documents.review_draft is
  'Incomplete UI review state. Final accounting data is still validated and stored in typed tables.';
notify pgrst,'reload schema';
