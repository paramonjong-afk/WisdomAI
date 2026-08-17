-- Embedded-VAT documents need a temporary gross subtotal as well as zero
-- separately-posted VAT so the legacy header reconciliation remains valid.
create or replace function public.confirm_accounting_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  doc public.accounting_documents;
  line_total numeric(14,2);
  credit_target numeric(14,2);
  original_vat numeric(14,2);
  original_subtotal numeric(14,2);
  temporary_subtotal numeric(14,2);
  vat_is_embedded boolean:=false;
begin
  select * into doc from public.accounting_documents where id=p_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if doc.document_type in ('invoice','invoice_tax_invoice','tax_invoice_full','billing_note') then
    raise exception 'three_way_match_required_before_ap';
  end if;

  select round(coalesce(sum(line_amount),0),2) into line_total
  from public.accounting_document_lines where document_id=p_document_id;
  credit_target:=round(coalesce(doc.total_amount,0)+coalesce(doc.withholding_tax_amount,0),2);
  original_vat:=coalesce(doc.vat_amount,0);
  original_subtotal:=doc.subtotal;
  temporary_subtotal:=round(coalesce(doc.total_amount,0)+coalesce(doc.discount_amount,0)+coalesce(doc.withholding_tax_amount,0),2);
  vat_is_embedded:=original_vat>0
    and abs(line_total-credit_target)<=0.01
    and abs((line_total+original_vat)-credit_target)>0.01;

  if vat_is_embedded then
    begin
      update public.accounting_documents
      set vat_amount=0,subtotal=temporary_subtotal
      where id=p_document_id;
      perform public.confirm_accounting_document_pre_match(p_document_id);
    exception when others then
      update public.accounting_documents
      set vat_amount=original_vat,subtotal=original_subtotal
      where id=p_document_id;
      raise;
    end;
    update public.accounting_documents
    set vat_amount=original_vat,subtotal=original_subtotal
    where id=p_document_id;
  else
    perform public.confirm_accounting_document_pre_match(p_document_id);
  end if;
end;
$$;

grant execute on function public.confirm_accounting_document(uuid) to authenticated;
comment on function public.confirm_accounting_document(uuid) is
  'Confirms non-AP documents, handling gross OCR lines with embedded VAT while retaining original VAT and subtotal metadata.';
notify pgrst,'reload schema';
