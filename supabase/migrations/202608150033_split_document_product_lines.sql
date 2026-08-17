-- Split one OCR/document line into real product variants while preserving the source.
alter table public.accounting_document_lines add column if not exists split_group_id uuid;
alter table public.accounting_document_lines add column if not exists split_original_description text;
alter table public.accounting_document_lines add column if not exists split_original_quantity numeric(14,3);
alter table public.accounting_document_lines add column if not exists split_attributes jsonb not null default '{}'::jsonb;
create index if not exists accounting_document_lines_split_group_idx on public.accounting_document_lines(document_id,split_group_id) where split_group_id is not null;

create or replace function public.split_accounting_document_line(p_line_id uuid,p_items jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare base public.accounting_document_lines;doc public.accounting_documents;input jsonb;group_value uuid;
  original_description text;original_quantity numeric(14,3);sum_quantity numeric(14,3):=0;item_count integer:=0;
  first_input jsonb;next_line integer;new_line_id uuid;created_ids uuid[]:='{}';item_quantity numeric(14,3);item_amount numeric(14,2);
begin
  select * into base from public.accounting_document_lines where id=p_line_id for update;
  if not found then raise exception 'document_line_not_found';end if;
  select * into doc from public.accounting_documents where id=base.document_id for update;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if doc.status not in ('pending','needs_correction') then raise exception 'only_unconfirmed_document_can_split';end if;
  original_description:=coalesce(base.split_original_description,base.description);
  original_quantity:=coalesce(base.split_original_quantity,base.quantity);
  if original_quantity is null or original_quantity<=0 then raise exception 'original_quantity_required';end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<2 then raise exception 'at_least_two_split_items_required';end if;
  for input in select value from jsonb_array_elements(p_items) loop
    if coalesce(trim(input->>'description'),'')='' then raise exception 'split_description_required';end if;
    item_quantity:=coalesce(nullif(input->>'quantity','')::numeric,0);if item_quantity<=0 then raise exception 'split_quantity_required';end if;
    sum_quantity:=sum_quantity+item_quantity;item_count:=item_count+1;if first_input is null then first_input:=input;end if;
  end loop;
  if abs(sum_quantity-original_quantity)>0.001 then raise exception 'split_quantity_mismatch_expected_%_actual_%',original_quantity,sum_quantity;end if;
  group_value:=coalesce(base.split_group_id,gen_random_uuid());
  delete from public.accounting_document_lines where document_id=base.document_id and split_group_id=group_value and id<>base.id;
  delete from public.accounting_line_allocations where document_line_id=base.id;
  item_quantity:=(first_input->>'quantity')::numeric;
  item_amount:=case when base.unit_price is not null then round(item_quantity*base.unit_price,2) else round(coalesce(base.line_amount,0)*item_quantity/original_quantity,2) end;
  update public.accounting_document_lines set description=trim(first_input->>'description'),quantity=item_quantity,line_amount=item_amount,
    split_group_id=group_value,split_original_description=original_description,split_original_quantity=original_quantity,
    split_attributes=coalesce(first_input->'attributes','{}'::jsonb),updated_at=now() where id=base.id;
  created_ids:=array_append(created_ids,base.id);
  select coalesce(max(line_number),0)+1 into next_line from public.accounting_document_lines where document_id=base.document_id;
  for input in select value from jsonb_array_elements(p_items) offset 1 loop
    item_quantity:=(input->>'quantity')::numeric;
    item_amount:=case when base.unit_price is not null then round(item_quantity*base.unit_price,2) else round(coalesce(base.line_amount,0)*item_quantity/original_quantity,2) end;
    insert into public.accounting_document_lines(document_id,line_number,description,product_code,quantity,unit,unit_price,line_amount,item_type,project_id,site_id,expense_category,cost_center_code,wbs_code,cost_category_id,account_code,account_name,notes,split_group_id,split_original_description,split_original_quantity,split_attributes)
    values(base.document_id,next_line,trim(input->>'description'),base.product_code,item_quantity,base.unit,base.unit_price,item_amount,base.item_type,base.project_id,base.site_id,base.expense_category,base.cost_center_code,base.wbs_code,base.cost_category_id,base.account_code,base.account_name,base.notes,group_value,original_description,original_quantity,coalesce(input->'attributes','{}'::jsonb)) returning id into new_line_id;
    created_ids:=array_append(created_ids,new_line_id);next_line:=next_line+1;
  end loop;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,before_dimensions,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('line_id',base.id,'description',original_description,'quantity',original_quantity),jsonb_build_object('split_group_id',group_value,'items',p_items),'manual_product_variant_split');
  return jsonb_build_object('split_group_id',group_value,'line_ids',created_ids,'item_count',item_count,'quantity',sum_quantity);
end;$$;
grant execute on function public.split_accounting_document_line(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
