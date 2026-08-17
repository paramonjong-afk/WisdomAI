-- Correct OCR counterparty and persist product quantity/name details with stock reconciliation.
create or replace function public.save_purchase_document_vendor(p_document_id uuid,p_vendor_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_vendor_name),'')='' then raise exception 'vendor_name_required'; end if;
  update public.accounting_documents set vendor_name=trim(p_vendor_name),counterparty_type='vendor',classification_source='human',updated_at=now() where id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('vendor_name',doc.vendor_name),jsonb_build_object('vendor_name',trim(p_vendor_name)),'manual_purchase_vendor_correction');
  return jsonb_build_object('status','saved','vendor_name',trim(p_vendor_name));
end; $$;
grant execute on function public.save_purchase_document_vendor(uuid,text) to authenticated;

create or replace function public.save_accounting_product_details(
  p_line_id uuid,p_description text,p_quantity numeric,p_unit text,p_unit_price numeric,p_item_type text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare line public.accounting_document_lines;doc public.accounting_documents;item public.inventory_items;old_data jsonb;movement_count integer:=0;
begin
  select * into line from public.accounting_document_lines where id=p_line_id for update;
  if not found then raise exception 'document_line_not_found'; end if;
  select * into doc from public.accounting_documents where id=line.document_id;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_description),'')='' then raise exception 'product_name_required'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'product_quantity_required'; end if;
  if p_item_type not in ('stock','direct_project','tool_asset','expense','service','labor') then raise exception 'invalid_item_type'; end if;
  old_data:=jsonb_build_object('description',line.description,'quantity',line.quantity,'unit',line.unit,'unit_price',line.unit_price,'item_type',line.item_type);
  update public.accounting_document_lines set description=trim(p_description),quantity=p_quantity,unit=nullif(trim(p_unit),''),unit_price=p_unit_price,
    line_amount=case when p_unit_price is null then line_amount else round(p_quantity*p_unit_price,2) end,item_type=p_item_type,updated_at=now() where id=line.id;
  if line.inventory_item_id is not null then
    update public.inventory_items set name=trim(p_description),normalized_name=lower(regexp_replace(trim(p_description),'\s+',' ','g')),product_code=coalesce(line.product_code,product_code),unit=coalesce(nullif(trim(p_unit),''),unit),updated_at=now()
    where id=line.inventory_item_id and not exists(select 1 from public.inventory_items other where other.id<>line.inventory_item_id and other.company_id=doc.company_id and other.normalized_name=lower(regexp_replace(trim(p_description),'\s+',' ','g')));
  end if;
  if doc.status='confirmed' and p_item_type='stock' then
    if line.inventory_item_id is null then raise exception 'confirmed_stock_item_requires_reconfirmation'; end if;
    update public.inventory_movements set quantity=p_quantity,unit_cost=p_unit_price,project_id=coalesce(line.project_id,doc.project_id)
    where document_line_id=line.id and movement_type='receipt';
    get diagnostics movement_count=row_count;
    if movement_count=0 then raise exception 'confirmed_stock_movement_requires_repair'; end if;
  end if;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',old_data,jsonb_build_object('line_id',line.id,'description',trim(p_description),'quantity',p_quantity,'unit',nullif(trim(p_unit),''),'unit_price',p_unit_price,'item_type',p_item_type,'stock_movement_updated',movement_count>0),'manual_product_detail_correction');
  return jsonb_build_object('updated',true,'stock_movement_updated',movement_count>0,'will_enter_stock_on_confirmation',doc.status<>'confirmed' and p_item_type='stock');
end; $$;
grant execute on function public.save_accounting_product_details(uuid,text,numeric,text,numeric,text) to authenticated;
notify pgrst,'reload schema';
