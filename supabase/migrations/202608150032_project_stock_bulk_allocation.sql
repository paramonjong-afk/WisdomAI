-- Project-owned stock, bulk receipt allocation, direct-use and auditable transfers/issues.
create table if not exists public.inventory_locations(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  code text, name text not null,active boolean not null default true,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(company_id,name)
);
create table if not exists public.goods_receipt_allocations(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  review_line_id uuid not null references public.goods_receipt_line_reviews(id) on delete cascade,
  project_id uuid references public.projects(id) on delete restrict,site_id uuid references public.project_sites(id) on delete restrict,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  allocation_mode text not null default 'project_stock' check(allocation_mode in ('central_stock','project_stock','direct_use')),
  quantity numeric(14,3) not null check(quantity>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.inventory_movements add column if not exists location_id uuid references public.inventory_locations(id) on delete restrict;
alter table public.inventory_movements add column if not exists receipt_allocation_id uuid references public.goods_receipt_allocations(id) on delete set null;
create table if not exists public.stock_operations(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  operation_type text not null check(operation_type in ('issue','transfer','waste')),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  from_project_id uuid references public.projects(id) on delete restrict,to_project_id uuid references public.projects(id) on delete restrict,
  from_location_id uuid not null references public.inventory_locations(id) on delete restrict,to_location_id uuid references public.inventory_locations(id) on delete restrict,
  quantity numeric(14,3) not null check(quantity>0),reason text not null,
  approved_by uuid references public.profiles(id) on delete set null,approved_at timestamptz not null default now(),created_at timestamptz not null default now()
);
alter table public.inventory_movements add column if not exists stock_operation_id uuid references public.stock_operations(id) on delete set null;
alter table public.inventory_locations enable row level security;
alter table public.goods_receipt_allocations enable row level security;
alter table public.stock_operations enable row level security;
create policy "Company members read inventory locations" on public.inventory_locations for select to authenticated using(public.is_company_member(company_id));
create policy "Managers maintain inventory locations" on public.inventory_locations for all to authenticated using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));
create policy "Managers read receipt allocations" on public.goods_receipt_allocations for select to authenticated using(public.is_company_manager(company_id));
create policy "Company members read stock operations" on public.stock_operations for select to authenticated using(public.is_company_member(company_id));
drop index if exists public.inventory_movement_document_line_unique;
create unique index if not exists inventory_movement_receipt_allocation_unique on public.inventory_movements(receipt_allocation_id,movement_type) where receipt_allocation_id is not null;

create or replace function public.confirm_goods_receipt_stock(
  p_document_id uuid,p_supplier_name text,p_receiving_location text default null,p_lines jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; review public.goods_receipt_reviews; input jsonb; allocation_input jsonb;
  line public.accounting_document_lines; review_line public.goods_receipt_line_reviews; item_id uuid; location_value public.inventory_locations;
  qty numeric(14,3);allocated_qty numeric(14,3);accepted_value boolean;condition_value text;received_count integer:=0;
  project_value uuid;site_value uuid;mode_value text;allocation_row public.goods_receipt_allocations;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.document_type<>'goods_receipt' then raise exception 'document_is_not_goods_receipt'; end if;
  if coalesce(trim(p_supplier_name),'')='' then raise exception 'supplier_name_required'; end if;
  if coalesce(trim(p_receiving_location),'')='' then raise exception 'receiving_location_required'; end if;
  insert into public.inventory_locations(company_id,name) values(doc.company_id,trim(p_receiving_location))
  on conflict(company_id,name) do update set active=true,updated_at=now() returning * into location_value;
  insert into public.goods_receipt_reviews(company_id,document_id,supplier_name,receiving_location,status,reviewed_by,reviewed_at)
  values(doc.company_id,doc.id,trim(p_supplier_name),location_value.name,'draft',auth.uid(),now())
  on conflict(document_id) do update set supplier_name=excluded.supplier_name,receiving_location=excluded.receiving_location,status='draft',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  returning * into review;
  for input in select value from jsonb_array_elements(p_lines) loop
    select * into line from public.accounting_document_lines where id=(input->>'line_id')::uuid and document_id=doc.id;
    if not found then raise exception 'goods_receipt_line_not_found'; end if;
    accepted_value:=coalesce((input->>'accepted')::boolean,false);qty:=coalesce(nullif(input->>'received_quantity','')::numeric,0);
    condition_value:=coalesce(nullif(input->>'condition',''),'good');
    if condition_value not in ('good','damaged','short','rejected') then raise exception 'invalid_goods_condition'; end if;
    if condition_value='rejected' then accepted_value:=false;qty:=0;end if;
    if accepted_value and qty<=0 then raise exception 'received_quantity_required_line_%',line.line_number;end if;
    insert into public.goods_receipt_line_reviews(company_id,review_id,document_line_id,accepted,received_quantity,condition,note)
    values(doc.company_id,review.id,line.id,accepted_value,qty,condition_value,nullif(trim(input->>'note'),''))
    on conflict(document_line_id) do update set accepted=excluded.accepted,received_quantity=excluded.received_quantity,condition=excluded.condition,note=excluded.note,updated_at=now()
    returning * into review_line;
    delete from public.inventory_movements where receipt_allocation_id in(select id from public.goods_receipt_allocations where review_line_id=review_line.id);
    delete from public.goods_receipt_allocations where review_line_id=review_line.id;
    if not accepted_value then continue;end if;
    insert into public.inventory_items(name,normalized_name,product_code,unit,item_kind)
    values(trim(line.description),lower(regexp_replace(trim(line.description),'\s+',' ','g')),line.product_code,line.unit,'material')
    on conflict(normalized_name) do update set product_code=coalesce(excluded.product_code,public.inventory_items.product_code),unit=coalesce(excluded.unit,public.inventory_items.unit),updated_at=now()
    returning id into item_id;
    update public.accounting_document_lines set item_type='stock',inventory_item_id=item_id,updated_at=now() where id=line.id;
    allocated_qty:=0;
    for allocation_input in select value from jsonb_array_elements(coalesce(input->'allocations','[]'::jsonb)) loop
      project_value:=nullif(allocation_input->>'project_id','')::uuid;site_value:=nullif(allocation_input->>'site_id','')::uuid;
      mode_value:=coalesce(nullif(allocation_input->>'mode',''),'project_stock');
      if mode_value not in ('central_stock','project_stock','direct_use') then raise exception 'invalid_allocation_mode';end if;
      if mode_value<>'central_stock' and project_value is null then raise exception 'project_required_line_%',line.line_number;end if;
      if project_value is not null and not exists(select 1 from public.projects where id=project_value and company_id=doc.company_id) then raise exception 'project_not_in_company';end if;
      if site_value is not null and not exists(select 1 from public.project_sites where id=site_value and project_id=project_value) then raise exception 'site_not_in_project';end if;
      qty:=coalesce(nullif(allocation_input->>'quantity','')::numeric,0);if qty<=0 then raise exception 'allocation_quantity_required_line_%',line.line_number;end if;
      insert into public.goods_receipt_allocations(company_id,review_line_id,project_id,site_id,location_id,allocation_mode,quantity)
      values(doc.company_id,review_line.id,project_value,site_value,location_value.id,mode_value,qty) returning * into allocation_row;
      insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,location_id,receipt_allocation_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
      values(doc.company_id,item_id,line.id,project_value,location_value.id,allocation_row.id,'receipt',qty,line.unit_price,coalesce(doc.document_date::timestamptz,now()),'รับเข้า '||location_value.name,auth.uid());
      if mode_value='direct_use' then
        insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,location_id,receipt_allocation_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
        values(doc.company_id,item_id,line.id,project_value,location_value.id,allocation_row.id,'issue',-qty,line.unit_price,coalesce(doc.document_date::timestamptz,now()),'รับและใช้ทันที',auth.uid());
      end if;
      allocated_qty:=allocated_qty+qty;
    end loop;
    if abs(allocated_qty-review_line.received_quantity)>0.001 then raise exception 'allocation_quantity_mismatch_line_%',line.line_number;end if;
    received_count:=received_count+1;
  end loop;
  if received_count=0 then raise exception 'select_at_least_one_received_line';end if;
  update public.goods_receipt_reviews set status='confirmed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=review.id;
  update public.accounting_documents set vendor_name=trim(p_supplier_name),status='confirmed',posting_status='not_posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('supplier_name',trim(p_supplier_name),'receiving_location',location_value.name,'received_line_count',received_count),'project_stock_receipt_confirmation');
  return jsonb_build_object('status','confirmed','received_line_count',received_count);
end;$$;
grant execute on function public.confirm_goods_receipt_stock(uuid,text,text,jsonb) to authenticated;

create or replace function public.process_project_stock_operation(
  p_operation_type text,p_inventory_item_id uuid,p_from_project_id uuid,p_from_location_id uuid,p_quantity numeric,
  p_to_project_id uuid default null,p_to_location_id uuid default null,p_reason text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare company_value uuid;available numeric(14,3);operation_id uuid;unit_cost_value numeric(14,2);
begin
  select company_id into company_value from public.inventory_movements where inventory_item_id=p_inventory_item_id and location_id=p_from_location_id order by created_at desc limit 1;
  if company_value is null then raise exception 'stock_not_found';end if;
  if not public.is_company_manager(company_value) then raise exception 'not_authorized';end if;
  if p_operation_type not in ('issue','transfer','waste') then raise exception 'invalid_stock_operation';end if;
  if p_quantity<=0 then raise exception 'quantity_required';end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'reason_required';end if;
  if p_operation_type='transfer' and (p_to_project_id is null or p_to_location_id is null) then raise exception 'transfer_destination_required';end if;
  select coalesce(sum(quantity),0),coalesce(sum(case when quantity>0 then quantity*coalesce(unit_cost,0) else 0 end)/nullif(sum(case when quantity>0 then quantity else 0 end),0),0)
  into available,unit_cost_value from public.inventory_movements
  where company_id=company_value and inventory_item_id=p_inventory_item_id and location_id=p_from_location_id and project_id is not distinct from p_from_project_id;
  if available<p_quantity then raise exception 'insufficient_project_stock';end if;
  insert into public.stock_operations(company_id,operation_type,inventory_item_id,from_project_id,to_project_id,from_location_id,to_location_id,quantity,reason,approved_by)
  values(company_value,p_operation_type,p_inventory_item_id,p_from_project_id,p_to_project_id,p_from_location_id,p_to_location_id,p_quantity,trim(p_reason),auth.uid()) returning id into operation_id;
  insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,stock_operation_id,movement_type,quantity,unit_cost,notes,created_by)
  values(company_value,p_inventory_item_id,p_from_project_id,p_from_location_id,operation_id,'issue',-p_quantity,unit_cost_value,
    case p_operation_type when 'waste' then 'ตัดของเสีย: ' else 'เบิก/โอนออก: ' end||trim(p_reason),auth.uid());
  if p_operation_type='transfer' then
    insert into public.inventory_movements(company_id,inventory_item_id,project_id,location_id,stock_operation_id,movement_type,quantity,unit_cost,notes,created_by)
    values(company_value,p_inventory_item_id,p_to_project_id,p_to_location_id,operation_id,'receipt',p_quantity,unit_cost_value,'รับโอน: '||trim(p_reason),auth.uid());
  end if;
  return operation_id;
end;$$;
grant execute on function public.process_project_stock_operation(text,uuid,uuid,uuid,numeric,uuid,uuid,text) to authenticated;

-- Split the receipt accrual debit between inventory and immediate project cost.
create or replace function public.create_goods_receipt_grni(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents;stock_total numeric(14,2);direct_total numeric(14,2);received_total numeric(14,2);next_line integer:=1;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found';end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized';end if;
  if doc.document_type<>'goods_receipt' or doc.status<>'confirmed' then raise exception 'confirmed_goods_receipt_required';end if;
  select coalesce(sum(case when a.allocation_mode<>'direct_use' then a.quantity*coalesce(l.unit_price,0) else 0 end),0),
         coalesce(sum(case when a.allocation_mode='direct_use' then a.quantity*coalesce(l.unit_price,0) else 0 end),0)
  into stock_total,direct_total from public.goods_receipt_allocations a join public.goods_receipt_line_reviews r on r.id=a.review_line_id join public.accounting_document_lines l on l.id=r.document_line_id where l.document_id=doc.id;
  received_total:=stock_total+direct_total;if received_total<=0 then raise exception 'received_value_required';end if;
  delete from public.accounting_draft_entries where document_id=doc.id;
  if stock_total>0 then insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description) values(doc.id,next_line,'1200','สินค้าคงเหลือ',stock_total,0,null,'รับเข้า Stock');next_line:=next_line+1;end if;
  if direct_total>0 then insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description) values(doc.id,next_line,'5100','ต้นทุนวัสดุโครงการ',direct_total,0,doc.project_id,'รับและใช้ทันที');next_line:=next_line+1;end if;
  insert into public.accounting_draft_entries(document_id,line_number,account_code,account_name,debit,credit,project_id,description) values(doc.id,next_line,'2110','รับสินค้าแล้วรอใบแจ้งหนี้ (GRNI)',0,received_total,doc.project_id,coalesce(doc.vendor_name,'ผู้ขายตามใบรับสินค้า'));
  update public.accounting_documents set posting_status='draft',updated_at=now() where id=doc.id;
  return jsonb_build_object('status','grni_draft','stock_amount',stock_total,'direct_cost_amount',direct_total,'amount',received_total);
end;$$;
grant execute on function public.create_goods_receipt_grni(uuid) to authenticated;

create or replace view public.inventory_project_balances with(security_invoker=true) as
select m.company_id,m.inventory_item_id,m.project_id,m.location_id,i.name,i.product_code,i.unit,l.name location_name,
  coalesce(sum(m.quantity),0) balance_quantity,
  coalesce(sum(case when m.quantity>0 then m.quantity*coalesce(m.unit_cost,0) else 0 end)/nullif(sum(case when m.quantity>0 then m.quantity else 0 end),0),0) average_unit_cost
from public.inventory_movements m join public.inventory_items i on i.id=m.inventory_item_id left join public.inventory_locations l on l.id=m.location_id
group by m.company_id,m.inventory_item_id,m.project_id,m.location_id,i.name,i.product_code,i.unit,l.name;
grant select on public.inventory_project_balances to authenticated;
notify pgrst,'reload schema';
