-- POSTING-005: append-only Stock gateway persistence. Existing inventory_movements remains authoritative.
create table if not exists public.inventory_item_company_scopes(
  company_id uuid not null references public.companies(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  master_unit text not null check(nullif(btrim(master_unit),'') is not null),
  status text not null default 'active' check(status in ('active','inactive')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(company_id,inventory_item_id)
);
create unique index if not exists inventory_locations_id_company_uniq on public.inventory_locations(id,company_id);
create unique index if not exists projects_id_company_uniq on public.projects(id,company_id);
create unique index if not exists accounting_documents_id_company_uniq on public.accounting_documents(id,company_id);
create unique index if not exists document_flow_items_id_company_uniq on public.document_flow_items(id,company_id);
create unique index if not exists posting_operations_id_company_uniq on public.posting_operations(id,company_id);
create table if not exists public.posting_stock_approval_lines(
  company_id uuid not null references public.companies(id) on delete restrict, document_id uuid not null, source_line_id uuid not null,
  line_number integer not null check(line_number>0), inventory_item_id uuid not null, location_id uuid not null, project_id uuid, purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete restrict,
  movement_kind text not null check(movement_kind in ('receipt','issue','adjustment')), quantity numeric(14,3) not null check(quantity<>0),
  unit text not null check(nullif(btrim(unit),'') is not null), unit_cost numeric(14,2) not null check(unit_cost>=0),
  ordered_quantity numeric(14,3), previously_received_quantity numeric(14,3), reason text, occurred_at timestamptz not null,
  revision integer not null default 1 check(revision>0), staging_hash text not null, staged_by uuid not null, staged_at timestamptz not null default now(), frozen_at timestamptz,
  created_at timestamptz not null default now(), primary key(company_id,document_id,source_line_id), unique(company_id,document_id,line_number), unique(company_id,source_line_id),
  foreign key(document_id,company_id) references public.accounting_documents(id,company_id),
  foreign key(company_id,inventory_item_id) references public.inventory_item_company_scopes(company_id,inventory_item_id),
  foreign key(location_id,company_id) references public.inventory_locations(id,company_id), foreign key(project_id,company_id) references public.projects(id,company_id)
);
create table if not exists public.stock_gateway_executions(
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
  transaction_key text not null, command_fingerprint text not null, posting_operation_id uuid not null,
  document_flow_item_id uuid not null, document_id uuid not null, intake_id uuid not null,
  approval_snapshot_id uuid not null, approval_snapshot_hash text not null, source_version integer not null,
  movement_kind text not null check(movement_kind in ('receipt','issue','adjustment')),
  status text not null default 'committed' check(status in ('unknown','committed','reversed')),
  reversal_execution_id uuid references public.stock_gateway_executions(id) on delete restrict,
  actor_id uuid, service_role text not null, committed_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(company_id,transaction_key), unique(id,company_id)
);
alter table public.stock_gateway_executions add constraint stock_gateway_execution_operation_company_fkey foreign key(posting_operation_id,company_id) references public.posting_operations(id,company_id);
alter table public.stock_gateway_executions add constraint stock_gateway_execution_flow_company_fkey foreign key(document_flow_item_id,company_id) references public.document_flow_items(id,company_id);
alter table public.stock_gateway_executions add constraint stock_gateway_execution_document_company_fkey foreign key(document_id,company_id) references public.accounting_documents(id,company_id);
alter table public.stock_gateway_executions add constraint stock_gateway_execution_snapshot_company_fkey foreign key(approval_snapshot_id,company_id) references public.posting_approval_snapshots(id,company_id);
create table if not exists public.stock_gateway_movement_links(
  id uuid primary key default gen_random_uuid(), execution_id uuid not null, company_id uuid not null,
  inventory_movement_id uuid not null references public.inventory_movements(id) on delete restrict,
  source_line_id uuid not null references public.accounting_document_lines(id) on delete restrict,
  line_number integer not null check(line_number>0), inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  location_id uuid not null references public.inventory_locations(id) on delete restrict, project_id uuid references public.projects(id) on delete restrict,
  quantity_delta numeric(14,3) not null check(quantity_delta<>0), balance_before numeric(14,3) not null, balance_after numeric(14,3) not null check(balance_after>=0),
  ordered_quantity numeric(14,3), previously_received_quantity numeric(14,3), receipt_state text check(receipt_state in ('partial','complete')),
  created_at timestamptz not null default now(), unique(execution_id,line_number),
  foreign key(execution_id,company_id) references public.stock_gateway_executions(id,company_id)
);
alter table public.stock_gateway_movement_links add constraint stock_gateway_link_source_company_fkey foreign key(company_id,source_line_id) references public.posting_stock_approval_lines(company_id,source_line_id);
alter table public.stock_gateway_movement_links add constraint stock_gateway_link_item_company_fkey foreign key(company_id,inventory_item_id) references public.inventory_item_company_scopes(company_id,inventory_item_id);
alter table public.stock_gateway_movement_links add constraint stock_gateway_link_location_company_fkey foreign key(location_id,company_id) references public.inventory_locations(id,company_id);
alter table public.stock_gateway_movement_links add constraint stock_gateway_link_project_company_fkey foreign key(project_id,company_id) references public.projects(id,company_id);
create table if not exists public.stock_gateway_events(
  id uuid primary key default gen_random_uuid(), execution_id uuid not null, company_id uuid not null,
  event_key text not null unique, event_type text not null check(event_type in ('started','committed','reversed')),
  actor_id uuid, service_role text not null, approval_snapshot_hash text not null, source_version integer not null, result_version integer not null,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key(execution_id,company_id) references public.stock_gateway_executions(id,company_id)
);
create index if not exists stock_gateway_links_source_idx on public.stock_gateway_movement_links(company_id,source_line_id,created_at);
alter table public.inventory_item_company_scopes enable row level security;
alter table public.posting_stock_approval_lines enable row level security;
alter table public.stock_gateway_executions enable row level security;
alter table public.stock_gateway_movement_links enable row level security;
alter table public.stock_gateway_events enable row level security;
create policy "Inventory managers read item tenant scopes" on public.inventory_item_company_scopes for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Inventory managers read approval Stock lines" on public.posting_stock_approval_lines for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Inventory managers read Stock executions" on public.stock_gateway_executions for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Inventory managers read Stock movement links" on public.stock_gateway_movement_links for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Inventory managers read Stock events" on public.stock_gateway_events for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
revoke insert,update,delete on public.inventory_item_company_scopes,public.stock_gateway_executions,public.stock_gateway_movement_links,public.stock_gateway_events from public,anon,authenticated;
revoke insert,update,delete on public.posting_stock_approval_lines from public,anon,authenticated;
grant select on public.inventory_item_company_scopes,public.posting_stock_approval_lines,public.stock_gateway_executions,public.stock_gateway_movement_links,public.stock_gateway_events to authenticated,service_role;

create or replace function public.prepare_posting_stock_line(target_document_id uuid,target_source_line_id uuid,target_location_id uuid,target_requested_quantity numeric,target_expected_revision integer default 0)
returns public.posting_stock_approval_lines language plpgsql security definer set search_path=public as $$
declare doc public.accounting_documents; source public.accounting_document_lines; po_line public.purchase_order_lines; canonical_po_line_id uuid; prior_revision integer; prior_frozen_at timestamptz; result public.posting_stock_approval_lines; canonical text;
begin
  select * into doc from public.accounting_documents where id=target_document_id for update;
  if doc.id is null or doc.company_id<>public.current_company_id() or not public.is_company_manager(doc.company_id) then raise exception 'stock_staging_not_authorized'; end if;
  if doc.status<>'confirmed' or doc.posting_status<>'draft' then raise exception 'stock_staging_document_invalid'; end if;
  select * into source from public.accounting_document_lines where id=target_source_line_id and document_id=doc.id and item_type='stock' for update;
  if source.id is null or source.inventory_item_id is null or coalesce(btrim(source.product_code),'')='' or coalesce(btrim(source.unit),'')='' or source.project_id is null or source.unit_price is null then raise exception 'stock_staging_source_incomplete'; end if;
  if not exists(select 1 from public.inventory_item_company_scopes s where s.company_id=doc.company_id and s.inventory_item_id=source.inventory_item_id and s.status='active' and lower(btrim(s.master_unit))=lower(btrim(source.unit))) then raise exception 'stock_legacy_item_reconciliation_required'; end if;
  if not exists(select 1 from public.inventory_locations l where l.id=target_location_id and l.company_id=doc.company_id and l.active) then raise exception 'stock_location_invalid'; end if;
  canonical_po_line_id:=nullif(to_jsonb(source)->>'purchase_order_line_id','')::uuid;
  if canonical_po_line_id is null then raise exception 'stock_source_purchase_order_line_link_required'; end if;
  select pol.* into po_line from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id and po.company_id=pol.company_id where pol.id=canonical_po_line_id and pol.company_id=doc.company_id and po.project_id=source.project_id and po.status in ('approved','partially_received') and btrim(pol.product_code)=btrim(source.product_code) and lower(btrim(pol.unit))=lower(btrim(source.unit)) and pol.unit_price=source.unit_price and pol.received_quantity<pol.quantity for update of pol;
  if po_line.id is null then raise exception 'stock_source_purchase_order_line_invalid'; end if;
  if target_requested_quantity<=0 or scale(target_requested_quantity)>3 or target_requested_quantity>po_line.quantity-po_line.received_quantity then raise exception 'stock_requested_quantity_exceeds_canonical_remaining'; end if;
  select revision,frozen_at into prior_revision,prior_frozen_at from public.posting_stock_approval_lines where company_id=doc.company_id and document_id=doc.id and source_line_id=source.id for update;
  if prior_frozen_at is not null then raise exception 'stock_staging_already_frozen'; end if;
  if coalesce(prior_revision,0)<>target_expected_revision then raise exception 'stock_staging_revision_conflict current=% expected=%',coalesce(prior_revision,0),target_expected_revision; end if;
  canonical:=concat_ws(':',doc.company_id,doc.id,source.id,source.inventory_item_id,target_location_id,source.project_id,po_line.id,target_requested_quantity,po_line.quantity,po_line.received_quantity,source.unit,source.unit_price,coalesce(prior_revision,0)+1,auth.uid());
  insert into public.posting_stock_approval_lines(company_id,document_id,source_line_id,line_number,inventory_item_id,location_id,project_id,purchase_order_line_id,movement_kind,quantity,unit,unit_cost,ordered_quantity,previously_received_quantity,occurred_at,revision,staging_hash,staged_by,staged_at)
  values(doc.company_id,doc.id,source.id,source.line_number,source.inventory_item_id,target_location_id,source.project_id,po_line.id,'receipt',target_requested_quantity,source.unit,po_line.unit_price,po_line.quantity,po_line.received_quantity,now(),coalesce(prior_revision,0)+1,encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex'),auth.uid(),now())
  on conflict(company_id,document_id,source_line_id) do update set location_id=excluded.location_id,purchase_order_line_id=excluded.purchase_order_line_id,quantity=excluded.quantity,unit_cost=excluded.unit_cost,ordered_quantity=excluded.ordered_quantity,previously_received_quantity=excluded.previously_received_quantity,occurred_at=excluded.occurred_at,revision=excluded.revision,staging_hash=excluded.staging_hash,staged_by=excluded.staged_by,staged_at=excluded.staged_at returning * into result;
  return result;
end $$;
revoke all on function public.prepare_posting_stock_line(uuid,uuid,uuid,numeric,integer) from public,anon,authenticated;

create or replace function public.approve_posting_stock_bundle(target_item_id uuid,target_expected_version integer,target_event_key text,target_note text,target_stock_inputs jsonb)
returns public.document_flow_items language plpgsql security definer set search_path=public as $$
declare item public.document_flow_items; replay_item public.document_flow_items; stock_input jsonb; source_id uuid; current_revision integer; result public.document_flow_items;
begin
  select flow.* into replay_item from public.document_flow_items flow join public.document_flow_events event on event.item_id=flow.id where event.event_key=target_event_key and flow.id=target_item_id and event.event_type='approve' limit 1;
  if replay_item.id is not null then return public.approve_posting_bundle(target_item_id,target_expected_version,target_event_key,target_note); end if;
  select * into item from public.document_flow_items where id=target_item_id for update;
  if item.id is null or item.company_id<>public.current_company_id() or not public.is_company_manager(item.company_id) then raise exception 'stock_bundle_not_authorized'; end if;
  if jsonb_typeof(target_stock_inputs)<>'array' then raise exception 'stock_bundle_inputs_required'; end if;
  if jsonb_array_length(target_stock_inputs)<>(select count(*) from public.accounting_document_lines where document_id=item.accounting_document_id and item_type='stock')
    or exists(select 1 from jsonb_array_elements(target_stock_inputs) x group by x->>'sourceLineId' having count(*)<>1)
    or exists(select 1 from jsonb_array_elements(target_stock_inputs) x where not exists(select 1 from public.accounting_document_lines l where l.id=(x->>'sourceLineId')::uuid and l.document_id=item.accounting_document_id and l.item_type='stock'))
    or exists(select 1 from public.accounting_document_lines l where l.document_id=item.accounting_document_id and l.item_type='stock' and not exists(select 1 from jsonb_array_elements(target_stock_inputs) x where (x->>'sourceLineId')::uuid=l.id)) then raise exception 'stock_bundle_exact_line_set_required'; end if;
  for stock_input in select value from jsonb_array_elements(target_stock_inputs) loop
    source_id:=(stock_input->>'sourceLineId')::uuid;
    select coalesce(max(revision),0) into current_revision from public.posting_stock_approval_lines where company_id=item.company_id and document_id=item.accounting_document_id and source_line_id=source_id;
    perform public.prepare_posting_stock_line(item.accounting_document_id,source_id,(stock_input->>'locationId')::uuid,(stock_input->>'requestedQuantity')::numeric,current_revision);
  end loop;
  result:=public.approve_posting_bundle(target_item_id,target_expected_version,target_event_key,target_note);
  return result;
end $$;
revoke all on function public.approve_posting_stock_bundle(uuid,integer,text,text,jsonb) from public,anon;
grant execute on function public.approve_posting_stock_bundle(uuid,integer,text,text,jsonb) to authenticated;

create or replace function public.capture_stock_lines_in_approval_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
declare lines jsonb; line_total numeric(16,2); invalid_count integer;
begin
  if not ('stock'=any(new.required_targets)) then return new; end if;
  select jsonb_agg(jsonb_build_object('lineNumber',s.line_number,'sourceLineId',s.source_line_id,'inventoryItemId',s.inventory_item_id,'unit',s.unit,'locationId',s.location_id,'projectId',s.project_id,'purchaseOrderLineId',s.purchase_order_line_id,'stagingRevision',s.revision,'stagingHash',s.staging_hash,'stagedBy',s.staged_by,'stagedAt',s.staged_at,'sourceQuantity',l.quantity,'unitCost',s.unit_cost,'quantity',s.quantity,'lineValue',round(abs(s.quantity)*s.unit_cost,2),'orderedQuantity',s.ordered_quantity,'previouslyReceivedQuantity',s.previously_received_quantity,'movementKind',s.movement_kind,'reason',s.reason,'occurredAt',s.occurred_at) order by s.line_number),round(sum(abs(s.quantity)*s.unit_cost),2)
  into lines,line_total from public.posting_stock_approval_lines s join public.accounting_document_lines l on l.id=s.source_line_id and l.document_id=s.document_id
  where s.company_id=new.company_id and s.document_id=new.document_id;
  if lines is null then raise exception 'stock_approval_lines_required'; end if;
  select count(*) into invalid_count from public.posting_stock_approval_lines s join public.purchase_order_lines pol on pol.id=s.purchase_order_line_id where s.company_id=new.company_id and s.document_id=new.document_id and (s.frozen_at is not null or pol.quantity<>s.ordered_quantity or pol.received_quantity<>s.previously_received_quantity or s.quantity>pol.quantity-pol.received_quantity);
  if invalid_count>0 then raise exception 'stock_staging_stale_or_tampered'; end if;
  new.snapshot:=jsonb_set(jsonb_set(new.snapshot,'{stockLines}',lines,true),'{stockTotalValue}',to_jsonb(line_total),true);
  new.snapshot_hash:=encode(extensions.digest(convert_to(new.snapshot::text,'UTF8'),'sha256'),'hex');
  update public.posting_stock_approval_lines set frozen_at=now() where company_id=new.company_id and document_id=new.document_id and frozen_at is null;
  return new;
end $$;
drop trigger if exists capture_stock_lines_in_approval_snapshot_trigger on public.posting_approval_snapshots;
create trigger capture_stock_lines_in_approval_snapshot_trigger before insert on public.posting_approval_snapshots for each row execute function public.capture_stock_lines_in_approval_snapshot();
create or replace function public.protect_posting_approval_snapshot() returns trigger language plpgsql set search_path=public as $$ begin
  if auth.role()='service_role' and current_setting('app.reviewed_stock_recovery',true)='true' then return case when tg_op='DELETE' then old else new end; end if;
  raise exception 'posting_approval_snapshot_immutable';
end $$;
drop trigger if exists protect_posting_approval_snapshot_trigger on public.posting_approval_snapshots;
create trigger protect_posting_approval_snapshot_trigger before update or delete on public.posting_approval_snapshots for each row execute function public.protect_posting_approval_snapshot();

create or replace function public.persist_stock_gateway(target_company_id uuid,target_operation_id uuid,target_command_fingerprint text,target_movement_kind text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.posting_operations; item public.document_flow_items; approval public.posting_approval_snapshots; existing public.stock_gateway_executions;
  execution public.stock_gateway_executions; source_line public.accounting_document_lines; scope_row public.inventory_item_company_scopes;
  location_row public.inventory_locations; project_row public.projects; line jsonb; movement public.inventory_movements; targets_pending boolean;
  tx_key text; expected_fingerprint text; balance_before numeric(14,3); delta numeric(14,3); qty numeric(14,3); historical_receipt numeric(14,3);
  ordered_qty numeric(14,3); prior_qty numeric(14,3); receipt_state text; flow_result_version integer:=1; unit_cost numeric; line_value numeric; command_total numeric:=0; expected_total numeric;
  prior_flow text; prior_state text; prior_room text; projected_flow text; projected_state text; projected_room text; recomputed_snapshot_hash text;
begin
  if auth.role()<>'service_role' then raise exception 'stock_gateway_service_role_required'; end if;
  if target_movement_kind not in ('receipt','issue','adjustment') then raise exception 'stock_movement_kind_invalid'; end if;
  select * into op from public.posting_operations where id=target_operation_id and company_id=target_company_id for update;
  if op.id is null or op.posting_type<>'stock' then raise exception 'stock_operation_not_found_or_scope_mismatch'; end if;
  tx_key:='stock-v1:'||target_company_id||':'||op.intake_id||':'||op.document_id||':'||op.id||':'||target_movement_kind;
  select * into existing from public.stock_gateway_executions e where e.company_id=target_company_id and e.transaction_key=tx_key;
  if existing.id is not null then
    if existing.command_fingerprint<>target_command_fingerprint then raise exception 'stock_idempotency_conflict'; end if;
    if existing.status='unknown' then return jsonb_build_object('mode','lookup','transaction_key',tx_key,'execution_id',existing.id); end if;
    if existing.status='reversed' then raise exception 'stock_execution_already_reversed'; end if;
    return jsonb_build_object('mode','replay','transaction_key',tx_key,'execution_id',existing.id);
  end if;
  if op.status not in ('reserved','processing','retry_wait') then raise exception 'stock_operation_not_executable'; end if;
  select * into item from public.document_flow_items where company_id=target_company_id and intake_id=op.intake_id and accounting_document_id=op.document_id for update;
  if item.id is null or item.state not in ('approved_waiting_gateway','posting') then raise exception 'stock_flow_state_invalid'; end if;
  select * into approval from public.posting_approval_snapshots where company_id=target_company_id and document_flow_item_id=item.id and document_id=op.document_id and 'stock'=any(required_targets) order by approved_at desc limit 1;
  if approval.id is null or approval.source_version>item.version then raise exception 'stock_canonical_snapshot_missing_reapproval_required'; end if;
  if approval.snapshot->'stockLines' is null or jsonb_typeof(approval.snapshot->'stockLines')<>'array' or jsonb_array_length(approval.snapshot->'stockLines')=0 then raise exception 'stock_canonical_snapshot_missing_reapproval_required'; end if;
  recomputed_snapshot_hash:=encode(extensions.digest(convert_to(approval.snapshot::text,'UTF8'),'sha256'),'hex');
  if recomputed_snapshot_hash<>approval.snapshot_hash then raise exception 'stock_approval_snapshot_hash_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(approval.snapshot->'stockLines') x group by x->>'lineNumber' having count(*)>1) or exists(select 1 from jsonb_array_elements(approval.snapshot->'stockLines') x group by x->>'sourceLineId' having count(*)>1) then raise exception 'stock_snapshot_line_identity_duplicate'; end if;
  expected_fingerprint:=encode(extensions.digest(convert_to(approval.snapshot_hash||':'||op.id||':'||target_movement_kind||':'||(approval.snapshot->'stockLines')::text,'UTF8'),'sha256'),'hex');
  if target_command_fingerprint<>expected_fingerprint then raise exception 'stock_approval_snapshot_tampered'; end if;
  insert into public.stock_gateway_executions(company_id,transaction_key,command_fingerprint,posting_operation_id,document_flow_item_id,document_id,intake_id,approval_snapshot_id,approval_snapshot_hash,source_version,movement_kind,actor_id,service_role)
  values(target_company_id,tx_key,target_command_fingerprint,op.id,item.id,op.document_id,op.intake_id,approval.id,approval.snapshot_hash,approval.source_version,target_movement_kind,auth.uid(),auth.role()) returning * into execution;
  insert into public.posting_operation_events(operation_id,company_id,event_key,event_type,from_status,to_status,payload,actor_id)
  values(op.id,target_company_id,tx_key||':started','started',op.status,'processing',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'service_role',auth.role(),'recovery','lookup_by_transaction_key'),auth.uid());
  update public.posting_operations set status='processing',updated_at=now() where id=op.id and company_id=target_company_id;
  for line in select value from jsonb_array_elements(approval.snapshot->'stockLines') loop
    if (line->>'movementKind')<>target_movement_kind then raise exception 'stock_snapshot_movement_kind_mismatch'; end if;
    select * into source_line from public.accounting_document_lines where id=(line->>'sourceLineId')::uuid and document_id=op.document_id for update;
    if source_line.id is null or source_line.item_type<>'stock' or source_line.inventory_item_id is distinct from (line->>'inventoryItemId')::uuid or lower(btrim(source_line.unit))<>lower(btrim(line->>'unit')) or source_line.project_id is distinct from nullif(line->>'projectId','')::uuid or source_line.quantity is distinct from (line->>'sourceQuantity')::numeric or source_line.unit_price is distinct from (line->>'unitCost')::numeric then raise exception 'stock_source_line_drift'; end if;
    select * into scope_row from public.inventory_item_company_scopes where company_id=target_company_id and inventory_item_id=source_line.inventory_item_id for update;
    if scope_row.inventory_item_id is null then raise exception 'stock_legacy_item_reconciliation_required'; end if;
    if scope_row.status<>'active' or lower(btrim(scope_row.master_unit))<>lower(btrim(line->>'unit')) then raise exception 'stock_item_or_unit_invalid'; end if;
    select * into location_row from public.inventory_locations where id=(line->>'locationId')::uuid and company_id=target_company_id and active for update;
    if location_row.id is null then raise exception 'stock_location_invalid'; end if;
    if nullif(line->>'projectId','') is not null then select * into project_row from public.projects where id=(line->>'projectId')::uuid and company_id=target_company_id for update; if project_row.id is null then raise exception 'stock_project_invalid'; end if; end if;
    select coalesce(sum(quantity),0) into balance_before from public.inventory_movements where company_id=target_company_id and inventory_item_id=source_line.inventory_item_id and location_id=location_row.id and project_id is not distinct from nullif(line->>'projectId','')::uuid;
    if (line->>'occurredAt') is null or (line->>'occurredAt')!~'^\d{4}-\d{2}-\d{2}T' then raise exception 'stock_occurred_at_invalid'; end if;
    qty:=(line->>'quantity')::numeric; unit_cost:=(line->>'unitCost')::numeric; line_value:=(line->>'lineValue')::numeric;
    if qty::text in ('NaN','Infinity','-Infinity') or qty=0 or scale(qty)>3 then raise exception 'stock_quantity_invalid'; end if;
    if unit_cost::text in ('NaN','Infinity','-Infinity') or unit_cost<0 or scale(unit_cost)>2 then raise exception 'stock_unit_cost_invalid'; end if;
    if line_value::text in ('NaN','Infinity','-Infinity') or line_value<0 or scale(line_value)>2 or line_value<>round(abs(qty)*unit_cost,2) then raise exception 'stock_line_value_invalid'; end if;
    command_total:=command_total+line_value;
    receipt_state:=null;
    if target_movement_kind='receipt' then
      if qty<0 then raise exception 'stock_receipt_quantity_invalid'; end if;
      ordered_qty:=(line->>'orderedQuantity')::numeric; prior_qty:=(line->>'previouslyReceivedQuantity')::numeric;
      select coalesce(sum(link.quantity_delta),0) into historical_receipt from public.stock_gateway_movement_links link join public.stock_gateway_executions prior on prior.id=link.execution_id and prior.company_id=link.company_id where link.company_id=target_company_id and link.source_line_id=source_line.id and prior.movement_kind='receipt' and prior.status='committed';
      if prior_qty<>historical_receipt then raise exception 'stock_receipt_context_stale'; end if;
      if prior_qty+qty>ordered_qty then raise exception 'stock_receipt_exceeds_ordered_quantity'; end if;
      receipt_state:=case when prior_qty+qty<ordered_qty then 'partial' else 'complete' end; delta:=qty;
    elsif target_movement_kind='issue' then if qty<=0 then raise exception 'stock_issue_quantity_invalid'; end if; delta:=-qty; if balance_before+delta<0 then raise exception 'stock_insufficient_balance'; end if;
    else if coalesce(btrim(line->>'reason'),'')='' then raise exception 'stock_adjustment_reason_required'; end if; delta:=qty; if balance_before+delta<0 then raise exception 'stock_adjustment_would_make_balance_negative'; end if; end if;
    insert into public.inventory_movements(company_id,inventory_item_id,document_line_id,project_id,location_id,movement_type,quantity,unit_cost,occurred_at,notes,created_by)
    values(target_company_id,source_line.inventory_item_id,source_line.id,nullif(line->>'projectId','')::uuid,location_row.id,target_movement_kind,delta,(line->>'unitCost')::numeric,(line->>'occurredAt')::timestamptz,'Posting Stock gateway '||tx_key,auth.uid()) returning * into movement;
    insert into public.stock_gateway_movement_links(execution_id,company_id,inventory_movement_id,source_line_id,line_number,inventory_item_id,location_id,project_id,quantity_delta,balance_before,balance_after,ordered_quantity,previously_received_quantity,receipt_state)
    values(execution.id,target_company_id,movement.id,source_line.id,(line->>'lineNumber')::integer,source_line.inventory_item_id,location_row.id,nullif(line->>'projectId','')::uuid,delta,balance_before,balance_before+delta,ordered_qty,prior_qty,receipt_state);
  end loop;
  expected_total:=(approval.snapshot->>'stockTotalValue')::numeric;
  if expected_total::text in ('NaN','Infinity','-Infinity') or expected_total<0 or scale(expected_total)>2 or command_total<>expected_total then raise exception 'stock_command_total_invalid'; end if;
  update public.posting_operations set status='posted',gateway_reference=execution.id::text,updated_at=now() where id=op.id and company_id=target_company_id;
  update public.posting_target_results set status='posted',gateway_reference=execution.id::text,result_version=result_version+1,posted_at=now(),updated_at=now() where snapshot_id=approval.id and company_id=target_company_id and target='stock';
  select exists(select 1 from public.posting_target_results where snapshot_id=approval.id and status<>'posted') into targets_pending;
  prior_flow:=item.current_flow; prior_state:=item.state; prior_room:=item.current_room;
  if not targets_pending then projected_flow:='completed';projected_state:='posted';projected_room:='completed_archive'; update public.document_flow_items set current_flow=projected_flow,state=projected_state,current_room=projected_room,version=version+1,updated_at=now() where id=item.id returning version into flow_result_version; update public.accounting_documents set posting_status='posted',updated_at=now() where id=op.document_id and company_id=target_company_id; else projected_flow:='posting';projected_state:='posting';projected_room:='posting_partial_targets'; update public.document_flow_items set current_flow=projected_flow,state=projected_state,current_room=projected_room,version=version+1,updated_at=now() where id=item.id returning version into flow_result_version; end if;
  insert into public.stock_gateway_events(execution_id,company_id,event_key,event_type,actor_id,service_role,approval_snapshot_hash,source_version,result_version,payload) values(execution.id,target_company_id,tx_key||':committed','committed',auth.uid(),auth.role(),approval.snapshot_hash,approval.source_version,flow_result_version,jsonb_build_object('movement_kind',target_movement_kind,'aggregate_complete',not targets_pending,'recovery','POSTING-008 immutable reversal'));
  insert into public.posting_operation_events(operation_id,company_id,event_key,event_type,from_status,to_status,payload,actor_id) values(op.id,target_company_id,tx_key||':posted','posted','processing','posted',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'result_version',flow_result_version,'execution_id',execution.id,'recovery','POSTING-008 immutable reversal'),auth.uid());
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,payload,actor_id) values(item.id,target_company_id,tx_key||':flow','stock_posted',prior_flow,projected_flow,prior_state,projected_state,prior_room,projected_room,jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'result_version',flow_result_version,'execution_id',execution.id,'aggregate_projection',jsonb_build_object('flow',projected_flow,'state',projected_state,'room',projected_room)),auth.uid());
  return jsonb_build_object('mode','committed','transaction_key',tx_key,'execution_id',execution.id,'aggregate_complete',not targets_pending);
end $$;
revoke all on function public.persist_stock_gateway(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.persist_stock_gateway(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
