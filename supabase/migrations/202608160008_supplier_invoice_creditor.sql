-- Explicitly confirm/edit the creditor used by supplier invoice AP creation.
create or replace function public.save_supplier_invoice_creditor(p_document_id uuid,p_creditor_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found';end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if doc.document_type not in ('invoice','invoice_tax_invoice','tax_invoice_full','billing_note') then raise exception 'supplier_invoice_required';end if;
  if coalesce(trim(p_creditor_name),'')='' then raise exception 'creditor_name_required';end if;
  update public.accounting_documents set vendor_name=trim(p_creditor_name),updated_at=now() where id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('vendor_name',doc.vendor_name),jsonb_build_object('vendor_name',trim(p_creditor_name)),'supplier_invoice_creditor_confirmation');
  return jsonb_build_object('status','saved','creditor_name',trim(p_creditor_name));
end;$$;
grant execute on function public.save_supplier_invoice_creditor(uuid,text) to authenticated;
notify pgrst,'reload schema';
