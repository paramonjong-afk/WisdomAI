-- Managers can complete/correct actual unit prices on confirmed receipts without changing posted accounting.
create or replace function public.save_confirmed_goods_receipt_prices(p_document_id uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;input jsonb;line public.accounting_document_lines;review public.goods_receipt_line_reviews;
  price_value numeric(14,4);before_values jsonb:='[]'::jsonb;after_values jsonb:='[]'::jsonb;updated_count integer:=0;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found';end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if doc.document_type<>'goods_receipt' or doc.status<>'confirmed' then raise exception 'confirmed_goods_receipt_required';end if;
  for input in select value from jsonb_array_elements(p_lines) loop
    select * into line from public.accounting_document_lines where id=(input->>'line_id')::uuid and document_id=doc.id;
    if not found then raise exception 'goods_receipt_line_not_found';end if;
    select * into review from public.goods_receipt_line_reviews where document_line_id=line.id and accepted;
    if not found then continue;end if;
    price_value:=nullif(input->>'unit_price','')::numeric;
    if price_value is null or price_value<0 then raise exception 'valid_unit_price_required_line_%',line.line_number;end if;
    before_values:=before_values||jsonb_build_array(jsonb_build_object('line_id',line.id,'unit_price',line.unit_price));
    update public.accounting_document_lines set unit_price=price_value,line_amount=round(review.received_quantity*price_value,2),updated_at=now() where id=line.id;
    after_values:=after_values||jsonb_build_array(jsonb_build_object('line_id',line.id,'unit_price',price_value,'received_quantity',review.received_quantity));
    updated_count:=updated_count+1;
  end loop;
  if updated_count=0 then raise exception 'no_received_lines_to_price';end if;
  perform public.capture_confirmed_document_prices(doc.id);
  update public.vendor_product_prices price set
    quantity=review.received_quantity,stated_unit_price=line.unit_price,effective_unit_price=line.unit_price,
    price_basis='actual',observed_at=coalesce(doc.document_date,doc.created_at::date),updated_at=now()
  from public.accounting_document_lines price_line join public.goods_receipt_line_reviews gr_line on gr_line.document_line_id=price_line.id and gr_line.accepted
  where price.document_line_id=price_line.id and price_line.document_id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('prices',before_values),jsonb_build_object('prices',after_values),'confirmed_goods_receipt_actual_price_correction');
  return jsonb_build_object('status','saved','updated_count',updated_count);
end;$$;
grant execute on function public.save_confirmed_goods_receipt_prices(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
