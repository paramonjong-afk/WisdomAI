-- Match a billing note against confirmed delivery notes and/or goods receipts from the selected vendor.
create or replace function public.confirm_billing_note_delivery_notes(p_billing_document_id uuid,p_delivery_note_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare bill public.accounting_documents; source_doc public.accounting_documents; source_id uuid;
  selected_total numeric(14,2):=0; selected_count integer:=0; matched_line_count integer:=0; unmatched_line_count integer:=0;
begin
  select * into bill from public.accounting_documents where id=p_billing_document_id for update;
  if not found then raise exception 'billing_note_not_found'; end if;
  if not public.is_company_manager(bill.company_id) then raise exception 'not_authorized'; end if;
  if bill.document_type<>'billing_note' then raise exception 'billing_note_required'; end if;
  if bill.status not in ('pending','needs_correction') then raise exception 'billing_note_already_confirmed'; end if;
  if coalesce(array_length(p_delivery_note_ids,1),0)=0 then raise exception 'receiving_document_required'; end if;
  delete from public.billing_delivery_note_links where billing_document_id=bill.id;

  foreach source_id in array p_delivery_note_ids loop
    select * into source_doc from public.accounting_documents where id=source_id for update;
    if not found or source_doc.company_id<>bill.company_id or source_doc.document_type not in ('delivery_note','goods_receipt') or source_doc.status<>'confirmed'
      then raise exception 'invalid_receiving_document_%',source_id; end if;
    if lower(regexp_replace(coalesce(source_doc.vendor_name,''),'\s+','','g'))<>lower(regexp_replace(coalesce(bill.vendor_name,''),'\s+','','g'))
      then raise exception 'receiving_document_vendor_mismatch_%',source_id; end if;
    insert into public.billing_delivery_note_links(company_id,billing_document_id,delivery_note_document_id,linked_by)
    values(bill.company_id,bill.id,source_doc.id,auth.uid());
    selected_total:=selected_total+coalesce(source_doc.total_amount,0); selected_count:=selected_count+1;
  end loop;

  select count(*) filter(where coalesce(received.received_quantity,0)>0 and abs(coalesce(received.received_quantity,0)-coalesce(line.quantity,0))<=.001),
         count(*) filter(where coalesce(received.received_quantity,0)=0 or abs(coalesce(received.received_quantity,0)-coalesce(line.quantity,0))>.001)
  into matched_line_count,unmatched_line_count
  from public.accounting_document_lines line
  left join lateral(
    select sum(coalesce(source_line.quantity,0)) received_quantity
    from public.billing_delivery_note_links link
    join public.accounting_document_lines source_line on source_line.document_id=link.delivery_note_document_id
    where link.billing_document_id=bill.id
      and lower(regexp_replace(trim(source_line.description),'\s+','','g'))=lower(regexp_replace(trim(line.description),'\s+','','g'))
  ) received on true where line.document_id=bill.id;

  update public.accounting_documents set status='confirmed',posting_status='not_posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=bill.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(bill.company_id,bill.id,auth.uid(),'human_review',jsonb_build_object('receiving_document_ids',p_delivery_note_ids,'receiving_document_count',selected_count,
    'receiving_total',selected_total,'billing_total',bill.total_amount,'variance',coalesce(bill.total_amount,0)-selected_total,
    'matched_line_count',matched_line_count,'unmatched_line_count',unmatched_line_count),'billing_note_receiving_documents_confirmed');
  return jsonb_build_object('status','confirmed','delivery_note_count',selected_count,'delivery_note_total',selected_total,'billing_total',bill.total_amount,
    'variance',coalesce(bill.total_amount,0)-selected_total,'matched_line_count',matched_line_count,'unmatched_line_count',unmatched_line_count);
end; $$;
grant execute on function public.confirm_billing_note_delivery_notes(uuid,uuid[]) to authenticated;
notify pgrst,'reload schema';
