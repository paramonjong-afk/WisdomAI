-- Combined receipt/tax-invoice document forms commonly issued as one document.
alter table public.accounting_documents
  drop constraint if exists accounting_documents_document_type_check;
alter table public.accounting_documents
  add constraint accounting_documents_document_type_check check(document_type in (
    'transfer_slip','receipt','tax_invoice_full','tax_invoice_abbreviated',
    'receipt_tax_invoice','invoice_tax_invoice','receipt_tax_invoice_abbreviated',
    'quotation','purchase_order','invoice','billing_note','delivery_note','goods_receipt',
    'withholding_tax_certificate','payroll','other','unreadable'
  ));

create or replace function public.classify_accounting_document(
  p_document_id uuid,
  p_document_type text,
  p_document_purpose text,
  p_apply_to_similar boolean default false
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents;
  vendor_key_value text;
  saved_rule_id uuid;
  affected integer:=0;
  allowed_types constant text[]:=array[
    'receipt','tax_invoice_full','tax_invoice_abbreviated','receipt_tax_invoice',
    'invoice_tax_invoice','receipt_tax_invoice_abbreviated','quotation','purchase_order','invoice',
    'billing_note','delivery_note','goods_receipt','withholding_tax_certificate','payroll','other','unreadable'
  ];
  allowed_purposes constant text[]:=array['material','subcontractor','service','labor','equipment','welfare','overhead','other'];
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.status not in ('pending','needs_correction') then raise exception 'confirmed_document_type_is_locked'; end if;
  if not (p_document_type=any(allowed_types)) then raise exception 'invalid_document_type'; end if;
  if not (p_document_purpose=any(allowed_purposes)) then raise exception 'invalid_document_purpose'; end if;

  update public.accounting_documents set
    document_type=p_document_type,document_purpose=p_document_purpose,
    classification_source='human',classification_rule_id=null,updated_at=now()
  where id=p_document_id;
  affected:=1;

  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',
    jsonb_build_object('document_type',doc.document_type,'document_purpose',doc.document_purpose),
    jsonb_build_object('document_type',p_document_type,'document_purpose',p_document_purpose),
    'manual_document_classification');

  if p_apply_to_similar and doc.document_type in ('other','unreadable') and coalesce(trim(doc.vendor_name),'')<>'' then
    vendor_key_value:=public.normalize_accounting_vendor(doc.vendor_name);
    insert into public.accounting_document_classification_rules(
      company_id,vendor_key,vendor_name,source_document_type,target_document_type,target_document_purpose,created_by
    ) values(doc.company_id,vendor_key_value,doc.vendor_name,doc.document_type,p_document_type,p_document_purpose,auth.uid())
    on conflict(company_id,vendor_key,source_document_type) do update set
      vendor_name=excluded.vendor_name,target_document_type=excluded.target_document_type,
      target_document_purpose=excluded.target_document_purpose,active=true,updated_at=now()
    returning id into saved_rule_id;

    with changed as (
      update public.accounting_documents other_doc set
        document_type=p_document_type,document_purpose=p_document_purpose,
        classification_source='learned_rule',classification_rule_id=saved_rule_id,updated_at=now()
      where other_doc.company_id=doc.company_id and other_doc.id<>doc.id
        and other_doc.status in ('pending','needs_correction')
        and other_doc.document_type=doc.document_type
        and public.normalize_accounting_vendor(other_doc.vendor_name)=vendor_key_value
      returning other_doc.id
    ) select affected+count(*) into affected from changed;
  end if;
  return affected;
end;
$$;
grant execute on function public.classify_accounting_document(uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
