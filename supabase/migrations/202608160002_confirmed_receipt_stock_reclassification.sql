-- Controlled correction of an already-confirmed receipt: reclassify one aggregate stock item into variants.
create or replace function public.reclassify_confirmed_receipt_stock_line(p_line_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare line public.accounting_document_lines;doc public.accounting_documents;review public.goods_receipt_line_reviews;
  allocation public.goods_receipt_allocations;input jsonb;item public.inventory_items;source_item uuid;
  expected numeric(14,3);total numeric(14,3):=0;qty numeric(14,3);available numeric(14,3);created_count integer:=0;
begin
  select * into line from public.accounting_document_lines where id=p_line_id for update;
  if not found then raise exception 'document_line_not_found';end if;
  select * into doc from public.accounting_documents where id=line.document_id for update;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if doc.document_type<>'goods_receipt' or doc.status<>'confirmed' then raise exception 'confirmed_goods_receipt_required';end if;
  select * into review from public.goods_receipt_line_reviews where document_line_id=line.id and accepted for update;
  if not found then raise exception 'accepted_receipt_line_required';end if;
  expected:=review.received_quantity;source_item:=line.inventory_item_id;
  if source_item is null then raise exception 'source_inventory_item_required';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<2 then raise exception 'at_least_two_split_items_required';end if;
  if (select count(*) from public.goods_receipt_allocations where review_line_id=review.id)<>1 then raise exception 'single_stock_allocation_required_for_correction';end if;
  select * into allocation from public.goods_receipt_allocations where review_line_id=review.id for update;
  if allocation.allocation_mode='direct_use' then raise exception 'direct_use_receipt_cannot_be_reclassified';end if;
  if exists(select 1 from public.accounting_document_dimension_audit where document_id=doc.id and reason='confirmed_receipt_stock_reclassification' and after_dimensions->>'line_id'=line.id::text) then raise exception 'stock_line_already_reclassified';end if;
  for input in select value from jsonb_array_elements(p_items) loop
    if coalesce(trim(input->>'description'),'')='' then raise exception 'split_description_required';end if;
    qty:=coalesce(nullif(input->>'quantity','')::numeric,0);if qty<=0 then raise exception 'split_quantity_required';end if;
    total:=total+qty;
  end loop;
  if abs(total-expected)>.001 then raise exception 'split_quantity_mismatch_expected_%_actual_%',expected,total;end if;
  select coalesce(sum(quantity),0) into available from public.inventory_movements
  where inventory_item_id=source_item and location_id=allocation.location_id and project_id is not distinct from allocation.project_id;
  if available<expected then raise exception 'insufficient_source_stock_available_%_required_%',available,expected;end if;
  insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,location_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
  values(doc.company_id,source_item,null,allocation.project_id,allocation.location_id,'adjustment',-expected,line.unit_price,now(),'ปรับแยกรายการจากใบรับสินค้า: '||line.description,auth.uid());
  for input in select value from jsonb_array_elements(p_items) loop
    qty:=(input->>'quantity')::numeric;
    insert into public.inventory_items(name,normalized_name,product_code,unit,item_kind)
    values(trim(input->>'description'),lower(regexp_replace(trim(input->>'description'),'\s+',' ','g')),null,line.unit,'material')
    on conflict(normalized_name) do update set unit=coalesce(excluded.unit,public.inventory_items.unit),updated_at=now() returning * into item;
    insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,location_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
    values(doc.company_id,item.id,null,allocation.project_id,allocation.location_id,'adjustment',qty,line.unit_price,now(),'แยกจากรายการรับสินค้า: '||line.description,auth.uid());
    created_count:=created_count+1;
  end loop;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('line_id',line.id,'description',line.description,'quantity',expected,'inventory_item_id',source_item),jsonb_build_object('line_id',line.id,'items',p_items,'quantity',total),'confirmed_receipt_stock_reclassification');
  return jsonb_build_object('status','reclassified','item_count',created_count,'quantity_before',expected,'quantity_after',total);
end;$$;
grant execute on function public.reclassify_confirmed_receipt_stock_line(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
