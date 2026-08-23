-- Auditable, idempotent batch reprocessing for Intake classification.
-- Raw source rows are never overwritten or deleted; every AI decision is append-only.

create table if not exists public.document_flow_reprocess_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  rule_version text not null,
  model_version text,
  requested_limit integer not null check (requested_limit > 0),
  status text not null default 'running' check (status in ('running','completed','failed')),
  processed_count integer not null default 0 check (processed_count >= 0),
  classified_count integer not null default 0 check (classified_count >= 0),
  routed_accounting_count integer not null default 0 check (routed_accounting_count >= 0),
  held_count integer not null default 0 check (held_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.document_flow_classification_history (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.document_flow_reprocess_batches(id) on delete restrict,
  item_id uuid not null references public.document_flow_items(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  source_message_id uuid not null references public.line_messages(id) on delete restrict,
  before_document_type text,
  after_document_type text,
  before_route_target text,
  after_route_target text,
  before_flow text,
  after_flow text,
  before_state text,
  after_state text,
  confidence numeric(5,4),
  rule_version text not null,
  model_version text,
  outcome text not null check (outcome in ('classified','routed_accounting','held','failed','skipped')),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, item_id)
);

create index if not exists document_flow_reprocess_batches_company_idx
  on public.document_flow_reprocess_batches(company_id, created_at desc);
create index if not exists document_flow_classification_history_item_idx
  on public.document_flow_classification_history(item_id, created_at desc);

alter table public.document_flow_reprocess_batches enable row level security;
alter table public.document_flow_classification_history enable row level security;

create policy "Managers read Intake reprocess batches" on public.document_flow_reprocess_batches
  for select to authenticated using (
    public.is_platform_admin()
    or (company_id = public.current_company_id() and public.is_company_manager(company_id))
  );
create policy "Managers read Intake classification history" on public.document_flow_classification_history
  for select to authenticated using (
    public.is_platform_admin()
    or (company_id = public.current_company_id() and public.is_company_manager(company_id))
  );

comment on table public.document_flow_classification_history is
  'Append-only AI/manual classification history for Intake reprocessing; original source and prior state remain intact.';
