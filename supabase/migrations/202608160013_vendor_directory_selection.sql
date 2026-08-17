-- Reuse a vendor directory across quotation, PO, receipt and payable documents.
create or replace function public.save_purchase_document_vendor(p_document_id uuid,p_vendor_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; vendor_record public.vendors;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_vendor_name),'')='' then raise exception 'vendor_name_required'; end if;

  select * into vendor_record from public.vendors
  where lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(trim(p_vendor_name),'\s+',' ','g'))
  order by created_at limit 1;
  if not found then
    insert into public.vendors(name) values(trim(p_vendor_name)) returning * into vendor_record;
  end if;

  update public.accounting_documents set vendor_id=vendor_record.id,vendor_name=vendor_record.name,
    counterparty_type='vendor',classification_source='human',updated_at=now() where id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('vendor_id',doc.vendor_id,'vendor_name',doc.vendor_name),
    jsonb_build_object('vendor_id',vendor_record.id,'vendor_name',vendor_record.name),'manual_purchase_vendor_directory_selection');
  return jsonb_build_object('status','saved','vendor_id',vendor_record.id,'vendor_name',vendor_record.name);
end; $$;
grant execute on function public.save_purchase_document_vendor(uuid,text) to authenticated;
notify pgrst,'reload schema';
