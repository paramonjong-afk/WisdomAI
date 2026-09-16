-- Resolve Posting operational prerequisites without guessing business data.
alter table public.accounting_document_lines
  add column if not exists purchase_order_line_id uuid;

create unique index if not exists purchase_order_lines_id_company_uniq
  on public.purchase_order_lines(id, company_id);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='accounting_document_lines_po_line_company_fkey') then
    alter table public.accounting_document_lines
      add constraint accounting_document_lines_po_line_company_fkey
      foreign key(purchase_order_line_id, company_id)
      references public.purchase_order_lines(id, company_id) on delete restrict;
  end if;
end $$;

create index if not exists accounting_document_lines_po_line_idx
  on public.accounting_document_lines(company_id, purchase_order_line_id)
  where purchase_order_line_id is not null;

create table if not exists public.posting_prerequisite_events(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  document_id uuid references public.accounting_documents(id) on delete restrict,
  source_line_id uuid references public.accounting_document_lines(id) on delete restrict,
  event_type text not null check(event_type in ('purchase_order_line_linked','accounting_period_opened')),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.posting_prerequisite_events enable row level security;
drop policy if exists "Managers read posting prerequisite events" on public.posting_prerequisite_events;
create policy "Managers read posting prerequisite events" on public.posting_prerequisite_events
  for select to authenticated using(public.is_company_manager(company_id));
revoke insert,update,delete on public.posting_prerequisite_events from anon,authenticated;

create or replace function public.get_posting_prerequisites(target_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; stock_lines jsonb; period_open boolean;
begin
  select * into doc from public.accounting_documents where id=target_document_id;
  if not found or not public.is_company_manager(doc.company_id) then raise exception 'posting_prerequisite_not_authorized'; end if;
  period_open:=exists(select 1 from public.accounting_periods p where p.company_id=doc.company_id and doc.document_date between p.period_start and p.period_end and p.status='open');
  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceLineId',line.id,
    'purchaseOrderLineId',line.purchase_order_line_id,
    'compatiblePurchaseOrderLines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pol.id,'label',po.po_number||' · '||pol.description,'remainingQuantity',pol.quantity-pol.received_quantity
    ) order by po.created_at desc)
      from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id and po.company_id=pol.company_id
      where pol.company_id=doc.company_id and po.status in ('approved','partially_received')
        and po.project_id=line.project_id and btrim(pol.product_code)=btrim(line.product_code)
        and lower(btrim(pol.unit))=lower(btrim(line.unit)) and pol.unit_price=line.unit_price
        and pol.received_quantity<pol.quantity),'[]'::jsonb)
  ) order by line.line_number),'[]'::jsonb) into stock_lines
  from public.accounting_document_lines line where line.document_id=doc.id and line.item_type='stock';
  return jsonb_build_object('accountingPeriodOpen',period_open,'stockLines',stock_lines);
end $$;

create or replace function public.configure_posting_purchase_order_line(target_source_line_id uuid,target_purchase_order_line_id uuid,target_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare line public.accounting_document_lines; doc public.accounting_documents; pol public.purchase_order_lines; po public.purchase_orders;
begin
  select * into line from public.accounting_document_lines where id=target_source_line_id for update;
  if not found or line.item_type<>'stock' then raise exception 'posting_stock_source_line_required'; end if;
  select * into doc from public.accounting_documents where id=line.document_id for update;
  if not public.is_company_manager(doc.company_id) then raise exception 'posting_prerequisite_not_authorized'; end if;
  if coalesce(btrim(target_reason),'')='' then raise exception 'posting_prerequisite_reason_required'; end if;
  if doc.posting_status='posted' or exists(select 1 from public.posting_operations op where op.company_id=doc.company_id and op.document_id=doc.id and op.status in ('reserved','processing','complete')) then raise exception 'posting_prerequisite_already_reserved'; end if;
  select * into pol from public.purchase_order_lines where id=target_purchase_order_line_id and company_id=doc.company_id for update;
  if pol.id is not null then select * into po from public.purchase_orders where id=pol.purchase_order_id and company_id=pol.company_id for update; end if;
  if pol.id is null or po.id is null or po.status not in ('approved','partially_received') or po.project_id is distinct from line.project_id
    or btrim(pol.product_code) is distinct from btrim(line.product_code) or lower(btrim(pol.unit)) is distinct from lower(btrim(line.unit))
    or pol.unit_price is distinct from line.unit_price or pol.received_quantity>=pol.quantity then raise exception 'posting_purchase_order_line_not_compatible'; end if;
  update public.accounting_document_lines set purchase_order_line_id=pol.id,updated_at=now() where id=line.id;
  insert into public.posting_prerequisite_events(company_id,document_id,source_line_id,event_type,actor_profile_id,reason,payload)
  values(doc.company_id,doc.id,line.id,'purchase_order_line_linked',auth.uid(),btrim(target_reason),jsonb_build_object('purchaseOrderLineId',pol.id,'purchaseOrderId',po.id,'poNumber',po.po_number));
  return jsonb_build_object('sourceLineId',line.id,'purchaseOrderLineId',pol.id);
end $$;

create or replace function public.open_posting_accounting_period_for_document(target_document_id uuid,target_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; period_start_value date; period_end_value date; period_row public.accounting_periods;
begin
  select * into doc from public.accounting_documents where id=target_document_id for update;
  if not found or not public.is_company_manager(doc.company_id) then raise exception 'posting_prerequisite_not_authorized'; end if;
  if doc.document_date is null then raise exception 'posting_document_date_required'; end if;
  if coalesce(btrim(target_reason),'')='' then raise exception 'posting_prerequisite_reason_required'; end if;
  if doc.posting_status='posted' or exists(select 1 from public.posting_operations op where op.company_id=doc.company_id and op.document_id=doc.id and op.status in ('reserved','processing','complete')) then raise exception 'posting_prerequisite_already_reserved'; end if;
  period_start_value:=date_trunc('month',doc.document_date)::date;
  period_end_value:=(date_trunc('month',doc.document_date)+interval '1 month-1 day')::date;
  if exists(select 1 from public.accounting_periods p where p.company_id=doc.company_id and p.status in ('closed','locked') and doc.document_date between p.period_start and p.period_end) then raise exception 'posting_accounting_period_closed_or_locked'; end if;
  insert into public.accounting_periods(company_id,period_start,period_end,status)
  values(doc.company_id,period_start_value,period_end_value,'open')
  on conflict(company_id,period_start,period_end) do update set status='open'
  returning * into period_row;
  insert into public.posting_prerequisite_events(company_id,document_id,event_type,actor_profile_id,reason,payload)
  values(doc.company_id,doc.id,'accounting_period_opened',auth.uid(),btrim(target_reason),jsonb_build_object('periodId',period_row.id,'periodStart',period_row.period_start,'periodEnd',period_row.period_end));
  return jsonb_build_object('periodId',period_row.id,'periodStart',period_row.period_start,'periodEnd',period_row.period_end,'status',period_row.status);
end $$;

revoke all on function public.get_posting_prerequisites(uuid) from public,anon;
revoke all on function public.configure_posting_purchase_order_line(uuid,uuid,text) from public,anon;
revoke all on function public.open_posting_accounting_period_for_document(uuid,text) from public,anon;
grant execute on function public.get_posting_prerequisites(uuid) to authenticated;
grant execute on function public.configure_posting_purchase_order_line(uuid,uuid,text) to authenticated;
grant execute on function public.open_posting_accounting_period_for_document(uuid,text) to authenticated;
notify pgrst,'reload schema';
