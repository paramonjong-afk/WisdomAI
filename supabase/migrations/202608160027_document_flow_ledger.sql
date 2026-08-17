-- Durable state machine for Intake Flow -> Filter Flow -> Posting Flow.
-- This migration only tracks and approves work. Route-specific accounting/Stock
-- posting remains the responsibility of a dedicated Posting Gateway.

create table if not exists public.document_flow_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  intake_id uuid not null,
  source_message_id uuid not null references public.line_messages(id) on delete cascade,
  review_case_id uuid references public.image_review_cases(id) on delete set null,
  accounting_document_id uuid references public.accounting_documents(id) on delete set null,
  current_flow text not null default 'intake'
    check (current_flow in ('intake','filter','posting','completed')),
  current_room text not null default 'intake_waiting_room',
  state text not null default 'received'
    check (state in (
      'received','ai_processing','awaiting_classification','validating','needs_correction',
      'duplicate_hold','ready_for_posting','awaiting_approval','approved_waiting_gateway',
      'posting','posted','rejected','failed','dismissed'
    )),
  document_type text,
  route_target text,
  confidence numeric(5,4),
  auto_routed boolean not null default false,
  quality_state text not null default 'unchecked',
  duplicate_state text not null default 'unchecked',
  issue_codes text[] not null default '{}',
  vendor_name text,
  project_id uuid references public.projects(id) on delete set null,
  total_amount numeric(14,2),
  assigned_to uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  version integer not null default 1 check (version > 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, intake_id),
  unique (review_case_id),
  unique (accounting_document_id)
);

create table if not exists public.document_flow_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.document_flow_items(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  from_flow text,
  to_flow text,
  from_state text,
  to_state text,
  from_room text,
  to_room text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists document_flow_items_company_queue_idx
  on public.document_flow_items(company_id,current_flow,state,updated_at desc);
create index if not exists document_flow_items_source_idx
  on public.document_flow_items(source_message_id);
create index if not exists document_flow_events_item_idx
  on public.document_flow_events(item_id,created_at desc);

alter table public.document_flow_items enable row level security;
alter table public.document_flow_events enable row level security;

drop policy if exists "Managers read document flow items" on public.document_flow_items;
create policy "Managers read document flow items" on public.document_flow_items
for select to authenticated using (
  public.is_platform_admin()
  or (company_id=public.current_company_id() and public.is_company_manager(company_id))
);

drop policy if exists "Managers read document flow events" on public.document_flow_events;
create policy "Managers read document flow events" on public.document_flow_events
for select to authenticated using (
  public.is_platform_admin()
  or (company_id=public.current_company_id() and public.is_company_manager(company_id))
);

create or replace function public.sync_document_flow_item(target_source_message_id uuid)
returns public.document_flow_items
language plpgsql
security definer
set search_path=public
as $$
declare
  review_row public.image_review_cases;
  document_row public.accounting_documents;
  result_row public.document_flow_items;
  target_company uuid;
  mapped_flow text := 'intake';
  mapped_state text := 'received';
  mapped_room text := 'intake_waiting_room';
  mapped_type text;
  mapped_route text;
  mapped_issues text[] := '{}';
begin
  select * into review_row from public.image_review_cases
  where source_message_id=target_source_message_id limit 1;
  select * into document_row from public.accounting_documents
  where source_message_id=target_source_message_id limit 1;

  target_company:=coalesce(document_row.company_id,review_row.company_id);
  if target_company is null then
    raise exception 'document_flow_company_missing';
  end if;

  mapped_type:=coalesce(document_row.document_type,review_row.confirmed_document_type,
    review_row.proposed_document_type,review_row.proposed_primary_purpose,'other');
  mapped_route:=case
    when mapped_type='quotation' then 'procurement_price_reference'
    when mapped_type='purchase_order' then 'purchase_order'
    when mapped_type in ('goods_receipt','delivery_note') then 'goods_receipt_stock'
    when mapped_type='billing_note' then 'billing_match'
    when mapped_type in ('invoice','receipt','tax_invoice_full','tax_invoice_abbreviated') then 'accounts_payable_tax'
    else 'document_reference'
  end;

  if document_row.id is not null then
    if document_row.status='confirmed' and document_row.posting_status='posted' then
      mapped_flow:='completed'; mapped_state:='posted'; mapped_room:='completed_archive';
    elsif document_row.status='confirmed' then
      mapped_flow:='posting'; mapped_state:='awaiting_approval'; mapped_room:='posting_approval_room';
    elsif document_row.status='needs_correction' then
      mapped_flow:='filter'; mapped_state:='needs_correction'; mapped_room:='filter_correction_room';
      mapped_issues:=array['document_needs_correction'];
    elsif document_row.status='duplicate' then
      mapped_flow:='filter'; mapped_state:='duplicate_hold'; mapped_room:='filter_duplicate_room';
      mapped_issues:=array['possible_duplicate'];
    elsif document_row.status='dismissed' then
      mapped_flow:='completed'; mapped_state:='dismissed'; mapped_room:='completed_archive';
    else
      mapped_flow:='filter'; mapped_state:='validating'; mapped_room:='filter_'||mapped_route;
    end if;
  elsif review_row.review_status in ('confirmed','corrected','forwarded') then
    mapped_flow:='filter'; mapped_state:='validating'; mapped_room:='filter_'||mapped_route;
  elsif review_row.review_status='dismissed' then
    mapped_flow:='completed'; mapped_state:='dismissed'; mapped_room:='completed_archive';
  elsif review_row.review_status='needs_information' then
    mapped_flow:='intake'; mapped_state:='awaiting_classification'; mapped_room:='intake_manual_review';
    mapped_issues:=array['needs_information'];
  elsif coalesce(review_row.ai_confidence,0)>=0.90 then
    mapped_flow:='filter'; mapped_state:='validating'; mapped_room:='filter_'||mapped_route;
  else
    mapped_flow:='intake'; mapped_state:='awaiting_classification'; mapped_room:='intake_manual_review';
    mapped_issues:=array['confidence_below_auto_threshold'];
  end if;

  insert into public.document_flow_items(
    company_id,intake_id,source_message_id,review_case_id,accounting_document_id,
    current_flow,current_room,state,document_type,route_target,confidence,auto_routed,
    duplicate_state,issue_codes,vendor_name,project_id,total_amount,last_error
  ) values (
    target_company,target_source_message_id,target_source_message_id,review_row.id,document_row.id,
    mapped_flow,mapped_room,mapped_state,mapped_type,mapped_route,
    coalesce(document_row.analysis_confidence,review_row.ai_confidence),
    coalesce(review_row.ai_confidence,0)>=0.90,
    case when document_row.status='duplicate' then 'duplicate' else 'clear' end,
    mapped_issues,document_row.vendor_name,
    coalesce(document_row.project_id,review_row.confirmed_project_id,review_row.proposed_project_id),
    document_row.total_amount,document_row.analysis_error
  )
  on conflict(company_id,intake_id) do update set
    review_case_id=coalesce(excluded.review_case_id,document_flow_items.review_case_id),
    accounting_document_id=coalesce(excluded.accounting_document_id,document_flow_items.accounting_document_id),
    current_flow=case when document_flow_items.state in ('approved_waiting_gateway','posting','rejected','failed')
      then document_flow_items.current_flow else excluded.current_flow end,
    current_room=case when document_flow_items.state in ('approved_waiting_gateway','posting','rejected','failed')
      then document_flow_items.current_room else excluded.current_room end,
    state=case when document_flow_items.state in ('approved_waiting_gateway','posting','rejected','failed')
      then document_flow_items.state else excluded.state end,
    document_type=excluded.document_type,route_target=excluded.route_target,
    confidence=excluded.confidence,auto_routed=excluded.auto_routed,
    duplicate_state=excluded.duplicate_state,issue_codes=excluded.issue_codes,
    vendor_name=excluded.vendor_name,project_id=excluded.project_id,
    total_amount=excluded.total_amount,last_error=excluded.last_error,
    version=document_flow_items.version+1,updated_at=now()
  returning * into result_row;

  insert into public.document_flow_events(
    item_id,company_id,event_key,event_type,to_flow,to_state,to_room,payload
  ) values (
    result_row.id,result_row.company_id,'sync:'||result_row.id::text||':'||result_row.version::text,
    'source_synced',result_row.current_flow,result_row.state,result_row.current_room,
    jsonb_build_object('source_message_id',target_source_message_id,'version',result_row.version)
  ) on conflict(event_key) do nothing;
  return result_row;
end;
$$;

create or replace function public.document_flow_source_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.sync_document_flow_item(new.source_message_id);
  return new;
exception when others then
  -- Source ingestion must never be lost because workflow projection failed.
  raise warning 'document flow sync failed for %: %',new.source_message_id,sqlerrm;
  return new;
end;
$$;

drop trigger if exists sync_document_flow_from_review on public.image_review_cases;
create trigger sync_document_flow_from_review after insert or update of
  review_status,confirmed_document_type,proposed_document_type,ai_confidence,confirmed_project_id
on public.image_review_cases for each row execute function public.document_flow_source_trigger();

drop trigger if exists sync_document_flow_from_accounting on public.accounting_documents;
create trigger sync_document_flow_from_accounting after insert or update of
  status,posting_status,document_type,vendor_name,project_id,total_amount,analysis_confidence,analysis_error
on public.accounting_documents for each row execute function public.document_flow_source_trigger();

create or replace function public.transition_document_flow_item(
  target_item_id uuid,
  target_action text,
  target_expected_version integer,
  target_event_key text,
  target_note text default null
) returns public.document_flow_items
language plpgsql
security definer
set search_path=public
as $$
declare
  before_row public.document_flow_items;
  result_row public.document_flow_items;
  next_flow text;
  next_state text;
  next_room text;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;

  select item.* into before_row from public.document_flow_items item
  join public.document_flow_events event on event.item_id=item.id
  where event.event_key=target_event_key limit 1;
  if before_row.id is not null then
    if not public.is_platform_admin() and not (
      before_row.company_id=public.current_company_id() and public.is_company_manager(before_row.company_id)
    ) then raise exception 'workflow_permission_denied'; end if;
    return before_row;
  end if;

  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if not public.is_platform_admin() and not (
    before_row.company_id=public.current_company_id() and public.is_company_manager(before_row.company_id)
  ) then raise exception 'workflow_permission_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;

  next_flow:=before_row.current_flow; next_state:=before_row.state; next_room:=before_row.current_room;
  case target_action
    when 'route_filter' then
      if before_row.current_flow<>'intake' then raise exception 'workflow_transition_not_allowed'; end if;
      next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference');
    when 'request_classification' then
      next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review';
    when 'request_correction' then
      if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if;
      next_flow:='filter'; next_state:='needs_correction'; next_room:='filter_correction_room';
    when 'ready_posting' then
      if before_row.current_flow<>'filter' or before_row.accounting_document_id is null then raise exception 'workflow_transition_not_allowed'; end if;
      if not exists(select 1 from public.accounting_documents where id=before_row.accounting_document_id and status='confirmed') then
        raise exception 'workflow_document_not_confirmed';
      end if;
      next_flow:='posting'; next_state:='awaiting_approval'; next_room:='posting_approval_room';
    when 'approve' then
      if before_row.current_flow<>'posting' or before_row.state<>'awaiting_approval' then raise exception 'workflow_transition_not_allowed'; end if;
      next_state:='approved_waiting_gateway'; next_room:='posting_gateway_queue';
    when 'reject' then
      if before_row.current_flow not in ('filter','posting') then raise exception 'workflow_transition_not_allowed'; end if;
      next_state:='rejected'; next_room:=before_row.current_flow||'_rejected_room';
    when 'retry' then
      if before_row.state not in ('failed','rejected') then raise exception 'workflow_transition_not_allowed'; end if;
      if before_row.current_flow='posting' then next_state:='awaiting_approval'; next_room:='posting_approval_room';
      else next_flow:='filter'; next_state:='validating'; next_room:='filter_'||coalesce(before_row.route_target,'document_reference'); end if;
    else raise exception 'workflow_action_unknown';
  end case;

  update public.document_flow_items set current_flow=next_flow,state=next_state,current_room=next_room,
    approved_by=case when target_action='approve' then auth.uid() else approved_by end,
    approved_at=case when target_action='approve' then now() else approved_at end,
    last_error=null,version=version+1,updated_at=now()
  where id=before_row.id returning * into result_row;

  insert into public.document_flow_events(
    item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,
    from_room,to_room,note,payload,actor_id
  ) values (
    result_row.id,result_row.company_id,target_event_key,target_action,
    before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,
    before_row.current_room,result_row.current_room,target_note,
    jsonb_build_object('expected_version',target_expected_version,'result_version',result_row.version),auth.uid()
  );
  return result_row;
end;
$$;

revoke all on public.document_flow_items,public.document_flow_events from anon,authenticated;
grant select on public.document_flow_items,public.document_flow_events to authenticated;
revoke execute on function public.sync_document_flow_item(uuid) from public,anon,authenticated;
revoke execute on function public.document_flow_source_trigger() from public,anon,authenticated;
revoke execute on function public.transition_document_flow_item(uuid,text,integer,text,text) from public,anon;
grant execute on function public.transition_document_flow_item(uuid,text,integer,text,text) to authenticated;

do $$
declare source_id uuid;
begin
  for source_id in
    select source_message_id from public.image_review_cases
    union select source_message_id from public.accounting_documents
  loop
    begin perform public.sync_document_flow_item(source_id);
    exception when others then raise warning 'document flow backfill skipped %: %',source_id,sqlerrm;
    end;
  end loop;
end;
$$;
