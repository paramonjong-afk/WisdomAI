-- Utility bills are service expenses: create AP directly without a goods receipt.
create or replace function public.create_utility_invoice_ap(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; utility_line_count integer;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.document_type not in ('invoice','invoice_tax_invoice','tax_invoice_full','billing_note') then raise exception 'supplier_invoice_required'; end if;
  if nullif(trim(doc.vendor_name),'') is null then raise exception 'creditor_required'; end if;
  if doc.project_id is null then raise exception 'project_required'; end if;
  select count(*) into utility_line_count from public.accounting_document_lines line
  where line.document_id=doc.id and line.description ~* '(ค่า[[:space:]]*ไฟ|ไฟฟ้า|ค่า[[:space:]]*น้ำ|ประปา|electric|water[[:space:]]*bill|utility)';
  if utility_line_count=0 then raise exception 'utility_expense_required'; end if;
  if exists(select 1 from public.accounting_document_lines line where line.document_id=doc.id and line.item_type in ('stock','direct_project','tool_asset')) then
    raise exception 'goods_or_asset_line_requires_receipt';
  end if;
  perform public.confirm_accounting_document_pre_match(doc.id);
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('workflow','utility_direct_ap','goods_receipt_required',false),'utility_invoice_direct_ap_created');
  return jsonb_build_object('status','confirmed','ap_created',true,'workflow','utility_direct_ap');
end; $$;
grant execute on function public.create_utility_invoice_ap(uuid) to authenticated;
notify pgrst,'reload schema';
