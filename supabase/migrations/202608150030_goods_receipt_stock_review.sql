-- Compact goods-receipt review: require supplier, verify each line and receive stock without AP posting.
create table if not exists public.goods_receipt_reviews(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null unique references public.accounting_documents(id) on delete cascade,
  supplier_name text not null,receiving_location text,status text not null default 'draft' check(status in ('draft','confirmed','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,reviewed_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.goods_receipt_line_reviews(
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  review_id uuid not null references public.goods_receipt_reviews(id) on delete cascade,
  document_line_id uuid not null unique references public.accounting_document_lines(id) on delete cascade,
  accepted boolean not null default true,received_quantity numeric(14,3) not null check(received_quantity>=0),
  condition text not null default 'good' check(condition in ('good','damaged','short','rejected')),note text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.goods_receipt_reviews enable row level security;
alter table public.goods_receipt_line_reviews enable row level security;
create policy "Managers read goods receipt reviews" on public.goods_receipt_reviews for select to authenticated using(public.is_company_manager(company_id));
create policy "Managers read goods receipt lines" on public.goods_receipt_line_reviews for select to authenticated using(public.is_company_manager(company_id));

create or replace function public.confirm_goods_receipt_stock(
  p_document_id uuid,p_supplier_name text,p_receiving_location text default null,p_lines jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents; review public.goods_receipt_reviews; input jsonb; line public.accounting_document_lines;
  item_id uuid; qty numeric(14,3); accepted_value boolean; condition_value text; received_count integer:=0;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.document_type<>'goods_receipt' then raise exception 'document_is_not_goods_receipt'; end if;
  if coalesce(trim(p_supplier_name),'')='' then raise exception 'supplier_name_required'; end if;

  insert into public.goods_receipt_reviews(company_id,document_id,supplier_name,receiving_location,status,reviewed_by,reviewed_at)
  values(doc.company_id,doc.id,trim(p_supplier_name),nullif(trim(p_receiving_location),''),'draft',auth.uid(),now())
  on conflict(document_id) do update set supplier_name=excluded.supplier_name,receiving_location=excluded.receiving_location,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
  returning * into review;

  for input in select value from jsonb_array_elements(p_lines) loop
    select * into line from public.accounting_document_lines where id=(input->>'line_id')::uuid and document_id=doc.id;
    if not found then raise exception 'goods_receipt_line_not_found'; end if;
    accepted_value:=coalesce((input->>'accepted')::boolean,false);
    qty:=coalesce(nullif(input->>'received_quantity','')::numeric,0);
    condition_value:=coalesce(nullif(input->>'condition',''),'good');
    if condition_value not in ('good','damaged','short','rejected') then raise exception 'invalid_goods_condition'; end if;
    if condition_value='rejected' then accepted_value:=false; qty:=0; end if;
    if accepted_value and qty<=0 then raise exception 'received_quantity_required_line_%',line.line_number; end if;

    insert into public.goods_receipt_line_reviews(company_id,review_id,document_line_id,accepted,received_quantity,condition,note)
    values(doc.company_id,review.id,line.id,accepted_value,qty,condition_value,nullif(trim(input->>'note'),''))
    on conflict(document_line_id) do update set accepted=excluded.accepted,received_quantity=excluded.received_quantity,condition=excluded.condition,note=excluded.note,updated_at=now();

    if accepted_value then
      insert into public.inventory_items(name,normalized_name,product_code,unit,item_kind)
      values(trim(line.description),lower(regexp_replace(trim(line.description),'\s+',' ','g')),line.product_code,line.unit,'material')
      on conflict(normalized_name) do update set product_code=coalesce(excluded.product_code,public.inventory_items.product_code),unit=coalesce(excluded.unit,public.inventory_items.unit),updated_at=now()
      returning id into item_id;
      update public.accounting_document_lines set item_type='stock',inventory_item_id=item_id,updated_at=now() where id=line.id;
      insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
      values(doc.company_id,item_id,line.id,doc.project_id,'receipt',qty,line.unit_price,coalesce(doc.document_date::timestamptz,now()),
        'รับสินค้าจาก '||trim(p_supplier_name)||coalesce(' · '||nullif(trim(p_receiving_location),''),''),auth.uid())
      on conflict do nothing;
      received_count:=received_count+1;
    end if;
  end loop;
  if received_count=0 then raise exception 'select_at_least_one_received_line'; end if;
  update public.goods_receipt_reviews set status='confirmed',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=review.id;
  update public.accounting_documents set vendor_name=trim(p_supplier_name),status='confirmed',posting_status='not_posted',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=doc.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('supplier_name',trim(p_supplier_name),'receiving_location',p_receiving_location,'received_line_count',received_count),'goods_receipt_stock_confirmation');
  return jsonb_build_object('status','confirmed','received_line_count',received_count);
end;
$$;
grant execute on function public.confirm_goods_receipt_stock(uuid,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
