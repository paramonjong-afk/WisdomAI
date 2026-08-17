-- Allow an explicit, audited type correction after confirmation without changing amounts or journal entries.
create or replace function public.correct_confirmed_accounting_document_type(
  p_document_id uuid,
  p_document_type text,
  p_document_purpose text,
  p_reason text default 'manual_type_correction'
) returns void
language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents;
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
  if doc.status<>'confirmed' then raise exception 'document_is_not_confirmed'; end if;
  if not (p_document_type=any(allowed_types)) then raise exception 'invalid_document_type'; end if;
  if not (p_document_purpose=any(allowed_purposes)) then raise exception 'invalid_document_purpose'; end if;

  update public.accounting_documents set
    document_type=p_document_type,document_purpose=p_document_purpose,
    classification_source='human',classification_rule_id=null,updated_at=now()
  where id=p_document_id;

  insert into public.accounting_document_dimension_audit(
    company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason
  ) values(
    doc.company_id,doc.id,auth.uid(),'human_review',
    jsonb_build_object('document_type',doc.document_type,'document_purpose',doc.document_purpose,'status',doc.status),
    jsonb_build_object('document_type',p_document_type,'document_purpose',p_document_purpose,'status',doc.status),
    coalesce(nullif(trim(p_reason),''),'manual_type_correction')
  );
end;
$$;
grant execute on function public.correct_confirmed_accounting_document_type(uuid,text,text,text) to authenticated;
comment on function public.correct_confirmed_accounting_document_type(uuid,text,text,text) is
  'Audited metadata-only correction. Does not modify allocations, amounts, posting status, or journal entries.';
notify pgrst,'reload schema';
