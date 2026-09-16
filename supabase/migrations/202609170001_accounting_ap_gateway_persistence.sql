-- POSTING-004: additive Accounting/AP persistence ledger and server-only atomic RPC.
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
  period_start date not null, period_end date not null, status text not null check(status in ('open','closed','locked')),
  created_at timestamptz not null default now(), unique(company_id,period_start,period_end), check(period_end>=period_start)
);
create table if not exists public.accounting_ap_transactions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
  transaction_key text not null, command_fingerprint text not null, document_flow_item_id uuid not null references public.document_flow_items(id) on delete restrict,
  accounting_operation_id uuid not null, ap_operation_id uuid not null, document_id uuid not null references public.accounting_documents(id) on delete restrict,
  intake_id uuid not null, document_version integer not null check(document_version>0), approval_event_key text not null,
  approval_snapshot_hash text not null, document_number text not null, document_date date not null, due_date date not null,
  currency text not null check(currency='THB'), vendor_id uuid, vendor_name text not null,
  taxable_base numeric(14,2) not null check(taxable_base>=0), input_tax numeric(14,2) not null check(input_tax>=0),
  withholding_tax numeric(14,2) not null check(withholding_tax>=0), net_payable numeric(14,2) not null check(net_payable>=0),
  debit_total numeric(14,2) not null, credit_total numeric(14,2) not null, created_at timestamptz not null default now(),
  unique(company_id,transaction_key), unique(company_id,accounting_operation_id), unique(company_id,ap_operation_id),
  check(due_date>=document_date), check(taxable_base+input_tax-withholding_tax=net_payable), check(debit_total=credit_total)
);
create table if not exists public.accounting_ap_journal_lines (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null references public.accounting_ap_transactions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, line_number integer not null check(line_number>0),
  account_code text not null, account_name text not null, role text not null check(role in ('base_debit','input_tax','accounts_payable','withholding_tax')),
  debit numeric(14,2) not null default 0 check(debit>=0), credit numeric(14,2) not null default 0 check(credit>=0),
  project_id uuid references public.projects(id) on delete restrict, description text not null, created_at timestamptz not null default now(),
  unique(transaction_id,line_number), check((debit>0 and credit=0) or (credit>0 and debit=0))
);
create table if not exists public.ap_obligations (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null unique references public.accounting_ap_transactions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, document_id uuid not null references public.accounting_documents(id) on delete restrict,
  vendor_id uuid, vendor_name text not null, due_date date not null, currency text not null check(currency='THB'),
  original_amount numeric(14,2) not null check(original_amount>=0), outstanding_amount numeric(14,2) not null check(outstanding_amount>=0),
  status text not null default 'open' check(status in ('open','partially_paid','paid','reversed')), created_at timestamptz not null default now(),
  unique(company_id,document_id)
);
create table if not exists public.ap_payment_links (
  id uuid primary key default gen_random_uuid(), obligation_id uuid not null unique references public.ap_obligations(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, link_key text not null, status text not null default 'available' check(status in ('available','settled','cancelled','reversed')),
  created_at timestamptz not null default now(), unique(company_id,link_key)
);
create table if not exists public.accounting_ap_events (
  id uuid primary key default gen_random_uuid(), transaction_id uuid not null references public.accounting_ap_transactions(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, event_key text not null, event_type text not null,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique(company_id,event_key)
);
create table if not exists public.posting_approval_snapshots (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete restrict,
  document_flow_item_id uuid not null references public.document_flow_items(id) on delete restrict,
  document_id uuid not null references public.accounting_documents(id) on delete restrict, intake_id uuid not null,
  approval_event_key text not null, source_version integer not null check(source_version>0), snapshot_hash text not null,
  snapshot jsonb not null, required_targets text[] not null, approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz not null, created_at timestamptz not null default now(), unique(company_id,approval_event_key),
  unique(company_id,document_flow_item_id,source_version)
);

create unique index if not exists vendors_id_company_uniq on public.vendors(id,company_id);
create unique index if not exists projects_id_company_uniq on public.projects(id,company_id);
create unique index if not exists accounting_documents_id_company_uniq on public.accounting_documents(id,company_id);
create unique index if not exists document_flow_items_id_company_uniq on public.document_flow_items(id,company_id);
create unique index if not exists posting_operations_id_company_uniq on public.posting_operations(id,company_id);
alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_flow_company_fkey foreign key(document_flow_item_id,company_id) references public.document_flow_items(id,company_id) not valid;
alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_document_company_fkey foreign key(document_id,company_id) references public.accounting_documents(id,company_id) not valid;
alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_vendor_company_fkey foreign key(vendor_id,company_id) references public.vendors(id,company_id) not valid;
alter table public.accounting_ap_journal_lines add constraint accounting_ap_journal_lines_project_company_fkey foreign key(project_id,company_id) references public.projects(id,company_id) not valid;
alter table public.ap_obligations add constraint ap_obligations_document_company_fkey foreign key(document_id,company_id) references public.accounting_documents(id,company_id) not valid;
alter table public.ap_obligations add constraint ap_obligations_vendor_company_fkey foreign key(vendor_id,company_id) references public.vendors(id,company_id) not valid;
alter table public.posting_approval_snapshots add constraint posting_approval_snapshots_flow_company_fkey foreign key(document_flow_item_id,company_id) references public.document_flow_items(id,company_id) not valid;
alter table public.posting_approval_snapshots add constraint posting_approval_snapshots_document_company_fkey foreign key(document_id,company_id) references public.accounting_documents(id,company_id) not valid;
create table if not exists public.posting_target_results (
  id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.posting_approval_snapshots(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict, target text not null check(target in ('accounting','ap','stock','purchase_order')),
  status text not null default 'pending' check(status in ('pending','posted','failed','reversed')), gateway_reference text,
  result_version integer not null default 0 check(result_version>=0), posted_at timestamptz, updated_at timestamptz not null default now(),
  unique(snapshot_id,target)
);

alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_id_company_uniq unique(id,company_id);
alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_accounting_operation_company_fkey foreign key(accounting_operation_id,company_id) references public.posting_operations(id,company_id);
alter table public.accounting_ap_transactions add constraint accounting_ap_transactions_ap_operation_company_fkey foreign key(ap_operation_id,company_id) references public.posting_operations(id,company_id);
alter table public.accounting_ap_journal_lines add constraint accounting_ap_journal_lines_transaction_company_fkey foreign key(transaction_id,company_id) references public.accounting_ap_transactions(id,company_id);
alter table public.ap_obligations add constraint ap_obligations_id_company_uniq unique(id,company_id);
alter table public.ap_obligations add constraint ap_obligations_transaction_company_fkey foreign key(transaction_id,company_id) references public.accounting_ap_transactions(id,company_id);
alter table public.ap_payment_links add constraint ap_payment_links_obligation_company_fkey foreign key(obligation_id,company_id) references public.ap_obligations(id,company_id);
alter table public.accounting_ap_events add constraint accounting_ap_events_transaction_company_fkey foreign key(transaction_id,company_id) references public.accounting_ap_transactions(id,company_id);
alter table public.posting_approval_snapshots add constraint posting_approval_snapshots_id_company_uniq unique(id,company_id);
alter table public.posting_target_results add constraint posting_target_results_snapshot_company_fkey foreign key(snapshot_id,company_id) references public.posting_approval_snapshots(id,company_id);

create or replace function public.capture_posting_approval_snapshot() returns trigger language plpgsql security definer set search_path=public as $$
declare item public.document_flow_items; doc public.accounting_documents; canonical jsonb; targets text[]; saved public.posting_approval_snapshots;
begin
  if new.event_type<>'approve' then return new; end if;
  select * into item from public.document_flow_items where id=new.item_id;
  select * into doc from public.accounting_documents where id=item.accounting_document_id and company_id=new.company_id;
  if doc.id is null then raise exception 'posting_approval_snapshot_source_missing'; end if;
  select array_agg(distinct operation.posting_type order by operation.posting_type) into targets from public.posting_operations operation where operation.company_id=new.company_id and operation.intake_id=item.intake_id and operation.document_id=doc.id and operation.status in ('reserved','processing','retry_wait','posted');
  if targets is null or not (targets @> array['accounting','ap']::text[]) then raise exception 'posting_approval_required_operation_set_missing'; end if;
  canonical:=jsonb_build_object('companyId',new.company_id,'intakeId',item.intake_id,'documentId',doc.id,'documentVersion',(new.payload->>'result_version')::integer,'approvalEventKey',new.event_key,'documentNumber',doc.document_number,'documentDate',doc.document_date,'dueDate',doc.due_date,'currency',doc.currency,'vendorId',doc.vendor_id,'vendorName',doc.vendor_name,'taxableBase',coalesce(doc.subtotal,0)-coalesce(doc.discount_amount,0),'inputTax',coalesce(doc.vat_amount,0),'withholdingTax',coalesce(doc.withholding_tax_amount,0),'netPayable',doc.total_amount,'requiredTargets',to_jsonb(targets),'journal',(select coalesce(jsonb_agg(jsonb_build_object('lineNumber',e.line_number,'accountCode',e.account_code,'accountName',e.account_name,'role',case when e.account_code='1150' then 'input_tax' when e.account_code='2100' then 'accounts_payable' when e.account_code='2150' then 'withholding_tax' else 'base_debit' end,'debit',e.debit,'credit',e.credit,'projectId',e.project_id,'description',coalesce(e.description,'')) order by e.line_number),'[]'::jsonb) from public.accounting_draft_entries e where e.document_id=doc.id));
  if canonical->>'documentNumber' is null or canonical->>'documentDate' is null or canonical->>'dueDate' is null or jsonb_array_length(canonical->'journal')<2 then raise exception 'posting_approval_snapshot_incomplete'; end if;
  insert into public.posting_approval_snapshots(company_id,document_flow_item_id,document_id,intake_id,approval_event_key,source_version,snapshot_hash,snapshot,required_targets,approved_by,approved_at)
  values(new.company_id,item.id,doc.id,item.intake_id,new.event_key,(new.payload->>'result_version')::integer,encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex'),canonical,targets,new.actor_id,new.created_at) returning * into saved;
  insert into public.posting_target_results(snapshot_id,company_id,target) select saved.id,new.company_id,unnest(targets);
  return new;
end $$;
drop trigger if exists capture_posting_approval_snapshot_trigger on public.document_flow_events;

create or replace function public.approve_posting_bundle(target_item_id uuid,target_expected_version integer,target_event_key text,target_note text default null)
returns public.document_flow_items language plpgsql security definer set search_path=public as $$
declare item public.document_flow_items; replay_item public.document_flow_items; doc public.accounting_documents; canonical jsonb; targets text[]; saved public.posting_approval_snapshots; target text;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select flow.* into replay_item from public.document_flow_items flow join public.document_flow_events event on event.item_id=flow.id where event.event_key=target_event_key and flow.id=target_item_id and event.event_type='approve' limit 1;
  if replay_item.id is not null then
    if replay_item.company_id<>public.current_company_id() or not public.is_company_manager(replay_item.company_id) then raise exception 'workflow_permission_denied'; end if;
    return replay_item;
  end if;
  select * into item from public.document_flow_items where id=target_item_id for update;
  if item.id is null then raise exception 'workflow_item_not_found'; end if;
  if item.company_id<>public.current_company_id() or not public.is_company_manager(item.company_id) then raise exception 'workflow_permission_denied'; end if;
  if item.current_flow<>'posting' or item.state<>'awaiting_approval' or item.version<>target_expected_version then raise exception 'posting_approval_state_or_version_invalid'; end if;
  select * into doc from public.accounting_documents where id=item.accounting_document_id and company_id=item.company_id for update;
  if doc.id is null or doc.status<>'confirmed' or doc.posting_status<>'draft' then raise exception 'posting_approval_source_invalid'; end if;
  if doc.document_type='quotation' then raise exception 'quotation_owned_by_quotation_decision_workflow'; end if;
  if doc.document_type is null or nullif(trim(doc.document_type),'') is null then raise exception 'posting_approval_document_type_required'; end if;
  if doc.document_type not in (
    'invoice','billing_note','receipt','cash_receipt','tax_invoice_full','tax_invoice_abbreviated',
    'invoice_tax_invoice','receipt_tax_invoice','receipt_tax_invoice_abbreviated'
  ) then raise exception 'posting_document_type_not_supported'; end if;
  if doc.created_by is not null and doc.created_by=auth.uid() then raise exception 'posting_approval_segregation_of_duties'; end if;
  targets:=array['accounting','ap']::text[];
  if exists(select 1 from public.accounting_document_lines line where line.document_id=doc.id and line.item_type='stock') then targets:=array_append(targets,'stock'); end if;
  if exists(select 1 from public.posting_operations operation where operation.company_id=item.company_id and operation.intake_id=item.intake_id and operation.document_id=doc.id) then raise exception 'posting_approval_preexisting_operations_refused'; end if;
  canonical:=jsonb_build_object('companyId',item.company_id,'intakeId',item.intake_id,'documentId',doc.id,'documentVersion',item.version+1,'approvalEventKey',target_event_key,'documentNumber',doc.document_number,'documentDate',doc.document_date,'dueDate',doc.due_date,'currency',doc.currency,'vendorId',doc.vendor_id,'vendorName',doc.vendor_name,'taxableBase',coalesce(doc.subtotal,0)-coalesce(doc.discount_amount,0),'inputTax',coalesce(doc.vat_amount,0),'withholdingTax',coalesce(doc.withholding_tax_amount,0),'netPayable',doc.total_amount,'requiredTargets',to_jsonb(targets),'journal',(select coalesce(jsonb_agg(jsonb_build_object('lineNumber',entry.line_number,'accountCode',entry.account_code,'accountName',entry.account_name,'role',case when entry.account_code='1150' then 'input_tax' when entry.account_code='2100' then 'accounts_payable' when entry.account_code='2150' then 'withholding_tax' else 'base_debit' end,'debit',entry.debit,'credit',entry.credit,'projectId',entry.project_id,'description',coalesce(entry.description,'')) order by entry.line_number),'[]'::jsonb) from public.accounting_draft_entries entry where entry.document_id=doc.id));
  if canonical->>'documentNumber' is null or canonical->>'documentDate' is null or canonical->>'dueDate' is null or jsonb_array_length(canonical->'journal')<2 then raise exception 'posting_approval_snapshot_incomplete'; end if;
  foreach target in array targets loop
    insert into public.posting_operations(company_id,intake_id,document_id,posting_type,idempotency_key,status,created_by)
    values(item.company_id,item.intake_id,doc.id,target,'posting-v1:'||item.company_id||':'||item.intake_id||':'||doc.id||':'||target,'reserved',auth.uid());
  end loop;
  update public.document_flow_items set state='approved_waiting_gateway',current_room='posting_gateway_queue',approved_by=auth.uid(),approved_at=now(),version=version+1,updated_at=now() where id=item.id returning * into item;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item.id,item.company_id,target_event_key,'approve','posting','posting','awaiting_approval','approved_waiting_gateway','posting_approval_room','posting_gateway_queue',target_note,jsonb_build_object('expected_version',target_expected_version,'result_version',item.version,'approved_targets',to_jsonb(targets),'bundle_atomic',true),auth.uid());
  insert into public.posting_approval_snapshots(company_id,document_flow_item_id,document_id,intake_id,approval_event_key,source_version,snapshot_hash,snapshot,required_targets,approved_by,approved_at)
  values(item.company_id,item.id,doc.id,item.intake_id,target_event_key,item.version,encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex'),canonical,targets,auth.uid(),now()) returning * into saved;
  insert into public.posting_target_results(snapshot_id,company_id,target) select saved.id,item.company_id,unnest(targets);
  return item;
end $$;
revoke all on function public.approve_posting_bundle(uuid,integer,text,text) from public,anon;
grant execute on function public.approve_posting_bundle(uuid,integer,text,text) to authenticated;

create index if not exists ap_obligations_queue_idx on public.ap_obligations(company_id,status,due_date,id);
alter table public.accounting_periods enable row level security; alter table public.accounting_ap_transactions enable row level security; alter table public.accounting_ap_journal_lines enable row level security;
alter table public.ap_obligations enable row level security; alter table public.ap_payment_links enable row level security; alter table public.accounting_ap_events enable row level security;
alter table public.posting_approval_snapshots enable row level security; alter table public.posting_target_results enable row level security;
create policy "Accounting roles read Accounting AP transactions" on public.accounting_ap_transactions for select to authenticated using(company_id=public.current_company_id() and (public.is_company_manager(company_id) or exists(select 1 from public.company_members m where m.company_id=accounting_ap_transactions.company_id and m.profile_id=auth.uid() and m.active and m.company_role='accounting_hr')));
create policy "Accounting roles read accounting periods" on public.accounting_periods for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read Accounting AP journal" on public.accounting_ap_journal_lines for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read AP obligations" on public.ap_obligations for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read AP payment links" on public.ap_payment_links for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read Accounting AP events" on public.accounting_ap_events for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read Posting approval snapshots" on public.posting_approval_snapshots for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Accounting roles read Posting target results" on public.posting_target_results for select to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id));
revoke insert,update,delete on public.accounting_periods,public.accounting_ap_transactions,public.accounting_ap_journal_lines,public.ap_obligations,public.ap_payment_links,public.accounting_ap_events,public.posting_approval_snapshots,public.posting_target_results from anon,authenticated;

create or replace function public.persist_accounting_ap_gateway(target_company_id uuid,target_accounting_operation_id uuid,target_ap_operation_id uuid,target_command_fingerprint text,target_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare accounting_op public.posting_operations; ap_op public.posting_operations; flow_item public.document_flow_items; projected public.document_flow_items; existing public.accounting_ap_transactions; approval public.posting_approval_snapshots; doc public.accounting_documents; canonical_command jsonb;
  saved public.accounting_ap_transactions; obligation public.ap_obligations; transaction_key text; journal jsonb; debit_total numeric(14,2); credit_total numeric(14,2);
  base_debit numeric(14,2); tax_debit numeric(14,2); ap_credit numeric(14,2); wht_credit numeric(14,2);
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service_role_required'; end if;
  if target_company_id is null or nullif(trim(target_command_fingerprint),'') is null then raise exception 'accounting_ap_identity_required'; end if;
  select * into existing from public.accounting_ap_transactions where company_id=target_company_id and accounting_operation_id=target_accounting_operation_id and ap_operation_id=target_ap_operation_id;
  if existing.id is not null then
    if existing.command_fingerprint<>trim(target_command_fingerprint) then raise exception 'accounting_ap_idempotency_conflict'; end if;
    return jsonb_build_object('mode','replay','transaction_id',existing.id,'obligation_id',(select id from public.ap_obligations where transaction_id=existing.id),'payment_link_id',(select l.id from public.ap_payment_links l join public.ap_obligations o on o.id=l.obligation_id where o.transaction_id=existing.id));
  end if;
  select * into accounting_op from public.posting_operations where id=target_accounting_operation_id and company_id=target_company_id for update;
  select * into ap_op from public.posting_operations where id=target_ap_operation_id and company_id=target_company_id for update;
  if accounting_op.id is null or ap_op.id is null or accounting_op.posting_type<>'accounting' or ap_op.posting_type<>'ap' then raise exception 'accounting_ap_operation_pair_required'; end if;
  if accounting_op.document_id is distinct from ap_op.document_id or accounting_op.intake_id is distinct from ap_op.intake_id or accounting_op.status not in ('reserved','processing','retry_wait') or ap_op.status not in ('reserved','processing','retry_wait') then raise exception 'accounting_ap_operation_scope_mismatch'; end if;
  select * into flow_item from public.document_flow_items where company_id=target_company_id and intake_id=accounting_op.intake_id and accounting_document_id=accounting_op.document_id for update;
  if flow_item.id is null or flow_item.current_flow<>'posting' or flow_item.state<>'approved_waiting_gateway' then raise exception 'accounting_ap_approval_state_invalid'; end if;
  select * into approval from public.posting_approval_snapshots where company_id=target_company_id and document_flow_item_id=flow_item.id and approval_event_key=target_payload->>'approvalEventKey';
  if approval.id is null then raise exception 'accounting_ap_canonical_snapshot_missing_reapproval_required'; end if;
  canonical_command:=approval.snapshot;
  if approval.source_version<>flow_item.version or approval.snapshot_hash<>target_payload->>'approvalSnapshotHash' or canonical_command <> (target_payload-'transactionKey'-'paymentLinkKey'-'approvalSnapshotHash') then raise exception 'accounting_ap_approval_snapshot_tampered'; end if;
  select * into doc from public.accounting_documents where id=approval.document_id and company_id=target_company_id;
  if doc.vendor_id is not null and not exists(select 1 from public.vendors vendor where vendor.id=doc.vendor_id and vendor.company_id=target_company_id) then raise exception 'accounting_ap_vendor_company_mismatch'; end if;
  if not exists(select 1 from public.accounting_periods period where period.company_id=target_company_id and (approval.snapshot->>'documentDate')::date between period.period_start and period.period_end and period.status='open') then raise exception 'accounting_ap_open_period_required'; end if;
  transaction_key:='accounting-ap-v1:'||lower(target_company_id::text)||':'||lower(approval.intake_id::text)||':'||lower(approval.document_id::text)||':'||approval.source_version;
  if target_payload->>'transactionKey'<>transaction_key or target_payload->>'paymentLinkKey'<>transaction_key||':payment-link' then raise exception 'accounting_ap_key_tampered'; end if;
  journal:=approval.snapshot->'journal';
  if (approval.snapshot->>'documentDate')!~'^\d{4}-\d{2}-\d{2}$' or (approval.snapshot->>'dueDate')!~'^\d{4}-\d{2}-\d{2}$' or approval.snapshot->>'currency'<>'THB' or (approval.snapshot->>'dueDate')::date<(approval.snapshot->>'documentDate')::date then raise exception 'accounting_ap_due_date_or_currency_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(journal) x group by (x->>'lineNumber')::integer having count(*)>1) or exists(select 1 from jsonb_array_elements(journal) x where x->>'role' not in ('base_debit','input_tax','accounts_payable','withholding_tax') or x->>'accountCode'!~'^[A-Za-z0-9._-]{1,32}$' or (x->>'debit')!~'^\d+(\.\d{1,2})?$' or (x->>'credit')!~'^\d+(\.\d{1,2})?$') then raise exception 'accounting_ap_journal_invalid'; end if;
  if doc.vendor_id is distinct from nullif(approval.snapshot->>'vendorId','')::uuid or exists(select 1 from jsonb_array_elements(journal) x where nullif(x->>'projectId','') is not null and not exists(select 1 from public.projects p where p.id=(x->>'projectId')::uuid and p.company_id=target_company_id)) then raise exception 'accounting_ap_master_data_company_mismatch'; end if;
  select coalesce(sum((x->>'debit')::numeric),0),coalesce(sum((x->>'credit')::numeric),0),coalesce(sum((x->>'debit')::numeric) filter(where x->>'role'='base_debit'),0),coalesce(sum((x->>'debit')::numeric) filter(where x->>'role'='input_tax'),0),coalesce(sum((x->>'credit')::numeric) filter(where x->>'role'='accounts_payable'),0),coalesce(sum((x->>'credit')::numeric) filter(where x->>'role'='withholding_tax'),0) into debit_total,credit_total,base_debit,tax_debit,ap_credit,wht_credit from jsonb_array_elements(journal) x;
  if debit_total<>credit_total or base_debit<>(target_payload->>'taxableBase')::numeric or tax_debit<>(target_payload->>'inputTax')::numeric or ap_credit<>(target_payload->>'netPayable')::numeric or wht_credit<>(target_payload->>'withholdingTax')::numeric or (target_payload->>'taxableBase')::numeric+(target_payload->>'inputTax')::numeric-(target_payload->>'withholdingTax')::numeric<>(target_payload->>'netPayable')::numeric then raise exception 'accounting_ap_amounts_unbalanced'; end if;
  insert into public.posting_operation_events(operation_id,company_id,event_key,event_type,from_status,to_status,payload,actor_id) values(accounting_op.id,target_company_id,transaction_key||':accounting:started','started',accounting_op.status,'processing',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'service_identity',auth.role()),auth.uid()),(ap_op.id,target_company_id,transaction_key||':ap:started','started',ap_op.status,'processing',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'service_identity',auth.role()),auth.uid());
  insert into public.accounting_ap_transactions(company_id,transaction_key,command_fingerprint,document_flow_item_id,accounting_operation_id,ap_operation_id,document_id,intake_id,document_version,approval_event_key,approval_snapshot_hash,document_number,document_date,due_date,currency,vendor_id,vendor_name,taxable_base,input_tax,withholding_tax,net_payable,debit_total,credit_total)
  values(target_company_id,transaction_key,trim(target_command_fingerprint),flow_item.id,accounting_op.id,ap_op.id,accounting_op.document_id,accounting_op.intake_id,flow_item.version,target_payload->>'approvalEventKey',target_payload->>'approvalSnapshotHash',target_payload->>'documentNumber',(target_payload->>'documentDate')::date,(target_payload->>'dueDate')::date,'THB',nullif(target_payload->>'vendorId','')::uuid,target_payload->>'vendorName',(target_payload->>'taxableBase')::numeric,(target_payload->>'inputTax')::numeric,(target_payload->>'withholdingTax')::numeric,(target_payload->>'netPayable')::numeric,debit_total,credit_total) returning * into saved;
  insert into public.accounting_ap_journal_lines(transaction_id,company_id,line_number,account_code,account_name,role,debit,credit,project_id,description)
  select saved.id,target_company_id,(x->>'lineNumber')::integer,x->>'accountCode',x->>'accountName',x->>'role',(x->>'debit')::numeric,(x->>'credit')::numeric,nullif(x->>'projectId','')::uuid,x->>'description' from jsonb_array_elements(journal) x;
  insert into public.ap_obligations(transaction_id,company_id,document_id,vendor_id,vendor_name,due_date,currency,original_amount,outstanding_amount)
  values(saved.id,target_company_id,saved.document_id,saved.vendor_id,saved.vendor_name,saved.due_date,'THB',saved.net_payable,saved.net_payable) returning * into obligation;
  insert into public.ap_payment_links(obligation_id,company_id,link_key) values(obligation.id,target_company_id,target_payload->>'paymentLinkKey');
  insert into public.accounting_ap_events(transaction_id,company_id,event_key,event_type,payload) values(saved.id,target_company_id,transaction_key||':committed','committed',jsonb_build_object('accounting_operation_id',accounting_op.id,'ap_operation_id',ap_op.id,'approval_event_key',saved.approval_event_key));
  update public.posting_operations set status='posted',gateway_reference=saved.id::text,updated_at=now() where id in(accounting_op.id,ap_op.id) and company_id=target_company_id;
  update public.posting_target_results set status='posted',gateway_reference=saved.id::text,result_version=result_version+1,posted_at=now(),updated_at=now() where snapshot_id=approval.id and company_id=target_company_id and target in ('accounting','ap');
  insert into public.posting_operation_events(operation_id,company_id,event_key,event_type,from_status,to_status,payload,actor_id) values(accounting_op.id,target_company_id,transaction_key||':accounting:posted','posted','processing','posted',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'result_version',1,'recovery','immutable_reversal','service_identity',auth.role()),auth.uid()),(ap_op.id,target_company_id,transaction_key||':ap:posted','posted','processing','posted',jsonb_build_object('snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'result_version',1,'recovery','immutable_reversal','service_identity',auth.role()),auth.uid());
  if not exists(select 1 from public.posting_target_results where snapshot_id=approval.id and status<>'posted') then
    update public.document_flow_items set state='posted',current_flow='completed',current_room='posting_completed',version=version+1,updated_at=now() where id=flow_item.id;
    update public.accounting_documents set posting_status='posted',updated_at=now() where id=saved.document_id and company_id=target_company_id;
  else
    update public.document_flow_items set state='posting',current_room='posting_partial_targets',version=version+1,updated_at=now() where id=flow_item.id;
  end if;
  select * into projected from public.document_flow_items where id=flow_item.id;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,payload,actor_id) values(flow_item.id,target_company_id,transaction_key||':document-flow','accounting_ap_posted',flow_item.current_flow,projected.current_flow,flow_item.state,projected.state,flow_item.current_room,projected.current_room,jsonb_build_object('transaction_id',saved.id,'obligation_id',obligation.id,'snapshot_hash',approval.snapshot_hash,'source_version',approval.source_version,'result_version',projected.version,'aggregate_projection',jsonb_build_object('flow',projected.current_flow,'state',projected.state,'room',projected.current_room),'service_identity',auth.role(),'recovery','immutable_reversal'),auth.uid());
  return jsonb_build_object('mode','committed','transaction_id',saved.id,'obligation_id',obligation.id,'payment_link_id',(select id from public.ap_payment_links where obligation_id=obligation.id));
end $$;
revoke all on function public.persist_accounting_ap_gateway(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.persist_accounting_ap_gateway(uuid,uuid,uuid,text,jsonb) to service_role;
grant select on public.accounting_ap_transactions,public.accounting_ap_journal_lines,public.ap_obligations,public.ap_payment_links,public.accounting_ap_events to service_role;
grant select on public.posting_approval_snapshots,public.posting_target_results to service_role;
grant select on public.accounting_periods to service_role;
notify pgrst,'reload schema';
