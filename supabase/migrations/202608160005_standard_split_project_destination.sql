-- Standard receipt-form destination per split variant, while retaining the audited base reclassification.
create or replace function public.reclassify_confirmed_receipt_stock_line_standard(p_line_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare line public.accounting_document_lines;doc public.accounting_documents;review public.goods_receipt_line_reviews;allocation public.goods_receipt_allocations;
  prior_audit public.accounting_document_dimension_audit;entry jsonb;inv public.inventory_items;qty numeric(14,3);available numeric(14,3);
  source_project uuid;target_project uuid;mode_value text;result jsonb;
begin
  select * into line from public.accounting_document_lines where id=p_line_id for update;
  if not found then raise exception 'document_line_not_found';end if;
  select * into doc from public.accounting_documents where id=line.document_id;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  select * into review from public.goods_receipt_line_reviews where document_line_id=line.id and accepted;
  select * into allocation from public.goods_receipt_allocations where review_line_id=review.id;
  source_project:=allocation.project_id;

  -- Bring the previous revision back to the source project before the base function reverses it.
  select * into prior_audit from public.accounting_document_dimension_audit where document_id=doc.id and reason='confirmed_receipt_stock_reclassification' and after_dimensions->>'line_id'=line.id::text order by created_at desc limit 1;
  if found then
    for entry in select value from jsonb_array_elements(prior_audit.after_dimensions->'items') loop
      qty:=(entry->>'quantity')::numeric;mode_value:=coalesce(nullif(entry->>'mode',''),'project_stock');
      target_project:=case when mode_value='central_stock' then null else coalesce(nullif(entry->>'project_id','')::uuid,source_project) end;
      select * into inv from public.inventory_items where normalized_name=lower(regexp_replace(trim(entry->>'description'),'\s+',' ','g'));
      if mode_value='direct_use' then
        insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,movement_type,quantity,unit_cost,notes,created_by)
        values(doc.company_id,inv.id,target_project,allocation.location_id,'adjustment',qty,line.unit_price,'ย้อนการเบิกใช้เพื่อแก้รายการแยก',auth.uid());
      end if;
      if target_project is distinct from source_project then
        select coalesce(sum(quantity),0) into available from public.inventory_movements where inventory_item_id=inv.id and location_id=allocation.location_id and project_id is not distinct from target_project;
        if available<qty then raise exception 'split_destination_stock_already_used_%',inv.name;end if;
        insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,movement_type,quantity,unit_cost,notes,created_by) values
        (doc.company_id,inv.id,target_project,allocation.location_id,'adjustment',-qty,line.unit_price,'ย้อนโครงการรายการแยก',auth.uid()),
        (doc.company_id,inv.id,source_project,allocation.location_id,'adjustment',qty,line.unit_price,'คืนเข้าโครงการต้นทางเพื่อแก้รายการแยก',auth.uid());
      end if;
    end loop;
  end if;

  result:=public.reclassify_confirmed_receipt_stock_line(p_line_id,p_items);

  -- Move each newly-created variant from the source allocation to its selected standard-form destination.
  for entry in select value from jsonb_array_elements(p_items) loop
    qty:=(entry->>'quantity')::numeric;mode_value:=coalesce(nullif(entry->>'mode',''),'project_stock');
    if mode_value not in ('central_stock','project_stock','direct_use') then raise exception 'invalid_allocation_mode';end if;
    target_project:=case when mode_value='central_stock' then null else nullif(entry->>'project_id','')::uuid end;
    if mode_value<>'central_stock' and target_project is null then raise exception 'project_required_for_split_item';end if;
    if target_project is not null and not exists(select 1 from public.projects where id=target_project and company_id=doc.company_id) then raise exception 'project_not_in_company';end if;
    if nullif(entry->>'site_id','') is not null and not exists(select 1 from public.project_sites where id=(entry->>'site_id')::uuid and project_id=target_project) then raise exception 'site_not_in_project';end if;
    select * into inv from public.inventory_items where normalized_name=lower(regexp_replace(trim(entry->>'description'),'\s+',' ','g'));
    if target_project is distinct from source_project then
      insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,movement_type,quantity,unit_cost,notes,created_by) values
      (doc.company_id,inv.id,source_project,allocation.location_id,'adjustment',-qty,line.unit_price,'ย้ายรายการแยกตามฟอร์มรับสินค้า',auth.uid()),
      (doc.company_id,inv.id,target_project,allocation.location_id,'adjustment',qty,line.unit_price,'รับเข้าโครงการตามฟอร์มรับสินค้า',auth.uid());
    end if;
    if mode_value='direct_use' then
      insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,movement_type,quantity,unit_cost,notes,created_by)
      values(doc.company_id,inv.id,target_project,allocation.location_id,'issue',-qty,line.unit_price,'รับและใช้ทันทีจากรายการแยก',auth.uid());
    end if;
  end loop;
  return result||jsonb_build_object('standard_destinations_saved',true);
end;$$;
grant execute on function public.reclassify_confirmed_receipt_stock_line_standard(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
