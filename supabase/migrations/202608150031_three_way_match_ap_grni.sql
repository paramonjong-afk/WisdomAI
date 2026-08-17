-- Three-way match: PO -> goods receipt/GRNI -> supplier invoice/AP.
create table if not exists public.procurement_invoice_matches(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_document_id uuid not null unique references public.accounting_documents(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete restrict,
  goods_receipt_document_id uuid not null references public.accounting_documents(id) on delete restrict,
  status text not null check(status in ('matched','exception','approved_exception')),
  po_amount numeric(14,2),received_amount numeric(14,2) not null,invoice_amount numeric(14,2) not null,
  variance_amount numeric(14,2) not null default 0,exception_reason text,
  matched_by uuid references public.profiles(id) on delete set null,matched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.procurement_invoice_matches enable row level security;
create policy "Managers read procurement invoice matches" on public.procurement_invoice_matches
  for select to authenticated using(public.is_company_manager(company_id));

-- A receipt is an accrued liability (GRNI), not trade AP. It is kept as a draft journal.
create or replace function public.create_goods_receipt_grni(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; received_total numeric(14,2); project_value uuid;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.document_type<>'goods_receipt' or doc.status<>'confirmed' then raise exception 'confirmed_goods_receipt_required'; end if;
  select coalesce(sum(r.received_quantity*coalesce(l.unit_price,0)),0)
    into received_total
  from public.goods_receipt_line_reviews r join public.accounting_document_lines l on l.id=r.document_line_id
  where l.document_id=doc.id and r.accepted;
  project_value:=doc.project_id;
  if received_total<=0 then raise exception 'received_value_required'; end if;
  delete from public.accounting_draft_entries where document_id=doc.id;
  insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
  values(doc.id,1,'1200','สินค้าคงเหลือ/ต้นทุนรับเข้า',received_total,0,project_value,'รับสินค้าเข้าสต็อก'),
        (doc.id,2,'2110','รับสินค้าแล้วรอใบแจ้งหนี้ (GRNI)',0,received_total,project_value,coalesce(doc.vendor_name,'ผู้ขายตามใบรับสินค้า'));
  update public.accounting_documents set posting_status='draft',updated_at=now() where id=doc.id;
  return jsonb_build_object('status','grni_draft','amount',received_total);
end; $$;
grant execute on function public.create_goods_receipt_grni(uuid) to authenticated;

create or replace function public.match_invoice_and_create_ap(
  p_invoice_document_id uuid,p_goods_receipt_document_id uuid,p_purchase_order_id uuid default null,
  p_approve_exception boolean default false,p_exception_reason text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare inv public.accounting_documents; receipt public.accounting_documents; po public.purchase_orders;
  received_total numeric(14,2); invoice_base numeric(14,2); po_total numeric(14,2); variance numeric(14,2); match_status text;
begin
  select * into inv from public.accounting_documents where id=p_invoice_document_id for update;
  select * into receipt from public.accounting_documents where id=p_goods_receipt_document_id;
  if inv.id is null or receipt.id is null then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(inv.company_id) then raise exception 'not_authorized'; end if;
  if inv.company_id<>receipt.company_id or receipt.document_type<>'goods_receipt' or receipt.status<>'confirmed' then raise exception 'invalid_goods_receipt'; end if;
  if inv.document_type not in ('invoice','invoice_tax_invoice','tax_invoice_full','billing_note') then raise exception 'supplier_invoice_required'; end if;
  if p_purchase_order_id is not null then
    select * into po from public.purchase_orders where id=p_purchase_order_id and company_id=inv.company_id;
    if not found then raise exception 'purchase_order_not_found'; end if;
    po_total:=po.subtotal;
  end if;
  select coalesce(sum(r.received_quantity*coalesce(l.unit_price,0)),0) into received_total
  from public.goods_receipt_line_reviews r join public.accounting_document_lines l on l.id=r.document_line_id
  where l.document_id=receipt.id and r.accepted;
  invoice_base:=coalesce(inv.subtotal,inv.total_amount-coalesce(inv.vat_amount,0)+coalesce(inv.withholding_tax_amount,0));
  variance:=round(invoice_base-received_total,2);
  match_status:=case when abs(variance)<=1 and (po_total is null or abs(invoice_base-po_total)<=1) then 'matched'
    when p_approve_exception then 'approved_exception' else 'exception' end;
  insert into public.procurement_invoice_matches(company_id,invoice_document_id,purchase_order_id,goods_receipt_document_id,status,po_amount,received_amount,invoice_amount,variance_amount,exception_reason,matched_by)
  values(inv.company_id,inv.id,p_purchase_order_id,receipt.id,match_status,po_total,received_total,invoice_base,variance,nullif(trim(p_exception_reason),''),auth.uid())
  on conflict(invoice_document_id) do update set purchase_order_id=excluded.purchase_order_id,goods_receipt_document_id=excluded.goods_receipt_document_id,status=excluded.status,
    po_amount=excluded.po_amount,received_amount=excluded.received_amount,invoice_amount=excluded.invoice_amount,variance_amount=excluded.variance_amount,
    exception_reason=excluded.exception_reason,matched_by=auth.uid(),matched_at=now(),updated_at=now();
  if match_status='exception' then
    update public.accounting_documents set status='needs_correction',posting_status='not_posted',updated_at=now() where id=inv.id;
    return jsonb_build_object('status',match_status,'variance_amount',variance,'ap_created',false);
  end if;
  delete from public.accounting_draft_entries where document_id=inv.id;
  insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
  values(inv.id,1,'2110','รับสินค้าแล้วรอใบแจ้งหนี้ (GRNI)',received_total,0,coalesce(inv.project_id,receipt.project_id),'ตัด GRNI จากใบรับสินค้า');
  if abs(variance)>0.01 then
    insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
    values(inv.id,2,'5190','ส่วนต่างราคาซื้อ',greatest(variance,0),greatest(-variance,0),coalesce(inv.project_id,receipt.project_id),'ส่วนต่างที่อนุมัติ');
  end if;
  if coalesce(inv.vat_amount,0)>0 then
    insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
    values(inv.id,3,'1150','ภาษีซื้อ',inv.vat_amount,0,inv.project_id,'ภาษีซื้อตามใบกำกับภาษี');
  end if;
  insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
  values(inv.id,4,'2100','เจ้าหนี้การค้า',0,coalesce(inv.total_amount,invoice_base+coalesce(inv.vat_amount,0)),inv.project_id,coalesce(inv.vendor_name,'เจ้าหนี้ตามใบแจ้งหนี้'));
  if coalesce(inv.withholding_tax_amount,0)>0 then
    insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description)
    values(inv.id,5,'2150','ภาษีหัก ณ ที่จ่ายค้างจ่าย',0,inv.withholding_tax_amount,inv.project_id,'ภาษีหัก ณ ที่จ่าย');
  end if;
  update public.accounting_documents set status='confirmed',posting_status='draft',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=inv.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(inv.company_id,inv.id,auth.uid(),'human_review',jsonb_build_object('match_status',match_status,'purchase_order_id',p_purchase_order_id,'goods_receipt_document_id',receipt.id,'variance',variance),'three_way_match_ap_created');
  return jsonb_build_object('status',match_status,'variance_amount',variance,'ap_created',true);
end; $$;
grant execute on function public.match_invoice_and_create_ap(uuid,uuid,uuid,boolean,text) to authenticated;

-- Preserve the project-allocation wrapper, but prevent supplier invoices bypassing matching.
alter function public.confirm_accounting_document(uuid) rename to confirm_accounting_document_pre_match;
create or replace function public.confirm_accounting_document(p_document_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id;
  if doc.document_type in ('invoice','invoice_tax_invoice','tax_invoice_full','billing_note') then
    raise exception 'three_way_match_required_before_ap';
  end if;
  perform public.confirm_accounting_document_pre_match(p_document_id);
end; $$;
grant execute on function public.confirm_accounting_document(uuid) to authenticated;
revoke execute on function public.confirm_accounting_document_pre_match(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
