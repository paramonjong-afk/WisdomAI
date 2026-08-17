-- Quotation decision, partial ordering, reference pricing and linked purchase orders.
create table if not exists public.quotation_decisions(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null unique references public.accounting_documents(id) on delete cascade,
  status text not null default 'pending' check(status in (
    'pending','ordered_full','ordered_partial','fully_ordered','not_ordered','reference_only','expired','cancelled'
  )),
  reason text,valid_until date,decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.quotation_line_decisions(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  quotation_decision_id uuid not null references public.quotation_decisions(id) on delete cascade,
  document_line_id uuid not null unique references public.accounting_document_lines(id) on delete cascade,
  offered_quantity numeric(14,3) not null default 0,
  ordered_quantity numeric(14,3) not null default 0,
  remaining_quantity numeric(14,3) generated always as (greatest(offered_quantity-ordered_quantity,0)) stored,
  selected boolean not null default false,
  updated_at timestamptz not null default now(),
  check(offered_quantity>=0 and ordered_quantity>=0 and ordered_quantity<=offered_quantity)
);
create table if not exists public.quotation_price_references(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  document_line_id uuid not null unique references public.accounting_document_lines(id) on delete cascade,
  vendor_name text,product_code text,description text not null,quantity numeric(14,3),unit text,
  unit_price numeric(14,4),effective_unit_price numeric(14,4),currency text not null default 'THB',
  observed_at date not null,valid_until date,decision_status text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.purchase_orders(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  source_quotation_document_id uuid references public.accounting_documents(id) on delete set null,
  po_number text not null,
  vendor_name text not null,currency text not null default 'THB',subtotal numeric(14,2) not null default 0,
  status text not null default 'approved' check(status in ('draft','pending_approval','approved','partially_received','received','cancelled')),
  approved_by uuid references public.profiles(id) on delete set null,approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(company_id,po_number)
);
create table if not exists public.purchase_order_lines(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  source_quotation_line_id uuid references public.accounting_document_lines(id) on delete set null,
  description text not null,product_code text,quantity numeric(14,3) not null check(quantity>0),unit text,
  unit_price numeric(14,4) not null default 0,line_amount numeric(14,2) not null default 0,
  received_quantity numeric(14,3) not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
  created_at timestamptz not null default now()
);
create index if not exists quotation_price_reference_compare_idx on public.quotation_price_references(company_id,description,observed_at desc);
create index if not exists purchase_orders_source_idx on public.purchase_orders(company_id,source_quotation_document_id,created_at desc);

alter table public.quotation_decisions enable row level security;
alter table public.quotation_line_decisions enable row level security;
alter table public.quotation_price_references enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
create policy "Managers read quotation decisions" on public.quotation_decisions for select to authenticated using(public.is_company_manager(company_id));
create policy "Managers read quotation line decisions" on public.quotation_line_decisions for select to authenticated using(public.is_company_manager(company_id));
create policy "Managers read quotation prices" on public.quotation_price_references for select to authenticated using(public.is_company_manager(company_id));
create policy "Managers read purchase orders" on public.purchase_orders for select to authenticated using(public.is_company_manager(company_id));
create policy "Managers read purchase order lines" on public.purchase_order_lines for select to authenticated using(public.is_company_manager(company_id));

create or replace function public.process_quotation_decision(
  p_document_id uuid,p_action text,p_lines jsonb default '[]'::jsonb,p_reason text default null,p_valid_until date default null,p_project_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  doc public.accounting_documents; decision public.quotation_decisions; line public.accounting_document_lines;
  input jsonb; requested numeric(14,3); po public.purchase_orders; total numeric(14,2):=0; selected_count integer:=0;
  next_status text; po_no text;
  target_project uuid;
begin
  select * into doc from public.accounting_documents where id=p_document_id for update;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(doc.company_id) then raise exception 'not_authorized'; end if;
  if doc.document_type<>'quotation' then raise exception 'document_is_not_quotation'; end if;
  if p_action not in ('order_full','order_partial','not_ordered','reference_only','expired','cancelled') then raise exception 'invalid_quotation_action'; end if;
  target_project:=coalesce(p_project_id,doc.project_id);
  if p_action in ('order_full','order_partial') and target_project is null then raise exception 'project_required_before_order'; end if;
  if target_project is not null and not exists(select 1 from public.projects where id=target_project and company_id=doc.company_id) then raise exception 'project_not_in_company'; end if;

  insert into public.quotation_decisions(company_id,document_id,status,reason,valid_until,decided_by,decided_at)
  values(doc.company_id,doc.id,'pending',nullif(trim(p_reason),''),p_valid_until,auth.uid(),now())
  on conflict(document_id) do update set reason=excluded.reason,valid_until=excluded.valid_until,decided_by=auth.uid(),decided_at=now(),updated_at=now()
  returning * into decision;

  for line in select * from public.accounting_document_lines where document_id=doc.id order by line_number loop
    insert into public.quotation_line_decisions(company_id,quotation_decision_id,document_line_id,offered_quantity)
    values(doc.company_id,decision.id,line.id,greatest(coalesce(line.quantity,1),0))
    on conflict(document_line_id) do update set offered_quantity=greatest(excluded.offered_quantity,public.quotation_line_decisions.ordered_quantity),updated_at=now();
    insert into public.quotation_price_references(company_id,document_id,document_line_id,vendor_name,product_code,description,quantity,unit,unit_price,effective_unit_price,currency,observed_at,valid_until,decision_status)
    values(doc.company_id,doc.id,line.id,doc.vendor_name,line.product_code,line.description,line.quantity,line.unit,line.unit_price,
      coalesce(line.unit_price,case when coalesce(line.quantity,0)>0 then line.line_amount/line.quantity end),doc.currency,
      coalesce(doc.document_date,doc.created_at::date),p_valid_until,p_action)
    on conflict(document_line_id) do update set unit_price=excluded.unit_price,effective_unit_price=excluded.effective_unit_price,valid_until=excluded.valid_until,decision_status=excluded.decision_status,updated_at=now();
  end loop;

  if p_action in ('order_full','order_partial') then
    po_no:='PO-'||to_char(current_date,'YYYYMM')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    insert into public.purchase_orders(company_id,project_id,source_quotation_document_id,po_number,vendor_name,currency,status,approved_by,approved_at,created_by)
    values(doc.company_id,target_project,doc.id,po_no,coalesce(nullif(trim(doc.vendor_name),''),'ไม่ระบุผู้ขาย'),doc.currency,'approved',auth.uid(),now(),auth.uid()) returning * into po;
    for input in select value from jsonb_array_elements(p_lines) loop
      select * into line from public.accounting_document_lines where id=(input->>'line_id')::uuid and document_id=doc.id;
      if not found then raise exception 'quotation_line_not_found'; end if;
      requested:=coalesce(nullif(input->>'quantity','')::numeric,
        (select remaining_quantity from public.quotation_line_decisions where document_line_id=line.id),0);
      if requested<=0 then continue; end if;
      if requested>(select remaining_quantity from public.quotation_line_decisions where document_line_id=line.id) then raise exception 'ordered_quantity_exceeds_remaining_line_%',line.line_number; end if;
      insert into public.purchase_order_lines(company_id,purchase_order_id,source_quotation_line_id,description,product_code,quantity,unit,unit_price,line_amount)
      values(doc.company_id,po.id,line.id,line.description,line.product_code,requested,line.unit,coalesce(line.unit_price,0),round(requested*coalesce(line.unit_price,0),2));
      update public.quotation_line_decisions set selected=true,ordered_quantity=ordered_quantity+requested,updated_at=now() where document_line_id=line.id;
      total:=total+round(requested*coalesce(line.unit_price,0),2); selected_count:=selected_count+1;
    end loop;
    if selected_count=0 then raise exception 'select_at_least_one_quotation_line'; end if;
    update public.purchase_orders set subtotal=total where id=po.id;
    next_status:=case when not exists(select 1 from public.quotation_line_decisions where quotation_decision_id=decision.id and remaining_quantity>0) then 'fully_ordered' when p_action='order_full' then 'ordered_full' else 'ordered_partial' end;
  else next_status:=case p_action when 'not_ordered' then 'not_ordered' when 'reference_only' then 'reference_only' when 'expired' then 'expired' else 'cancelled' end;
  end if;
  update public.quotation_decisions set status=next_status,updated_at=now() where id=decision.id;
  insert into public.accounting_document_dimension_audit(company_id,document_id,actor_profile_id,source,after_dimensions,reason)
  values(doc.company_id,doc.id,auth.uid(),'human_review',jsonb_build_object('quotation_status',next_status,'purchase_order_id',po.id,'purchase_order_number',po.po_number),'quotation_decision');
  return jsonb_build_object('status',next_status,'purchase_order_id',po.id,'purchase_order_number',po.po_number,'ordered_total',total);
end;
$$;
grant execute on function public.process_quotation_decision(uuid,text,jsonb,text,date,uuid) to authenticated;
notify pgrst,'reload schema';
