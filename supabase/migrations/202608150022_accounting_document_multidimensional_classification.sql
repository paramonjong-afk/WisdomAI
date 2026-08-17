-- Multidimensional accounting-document classification. One source image remains
-- canonical while searchable accounting dimensions are stored on its document.
alter table public.accounting_documents
  add column if not exists flow_direction text not null default 'unknown'
    check(flow_direction in ('income','expense','commitment','internal_transfer','refund','advance','unknown')),
  add column if not exists lifecycle_stage text not null default 'draft'
    check(lifecycle_stage in ('draft','pending_approval','approved','awaiting_receipt','received','awaiting_invoice','invoiced','awaiting_payment','partially_paid','paid','cancelled','posted','unknown')),
  add column if not exists counterparty_type text not null default 'unknown'
    check(counterparty_type in ('vendor','customer','employee','contractor','bank','government','unknown')),
  add column if not exists expense_categories text[] not null default '{}',
  add column if not exists cost_center_code text,
  add column if not exists wbs_code text,
  add column if not exists contract_reference text,
  add column if not exists tax_invoice_number text,
  add column if not exists tax_date date,
  add column if not exists vat_rate numeric(6,3),
  add column if not exists withholding_tax_rate numeric(6,3),
  add column if not exists payment_status text not null default 'unknown'
    check(payment_status in ('not_due','unpaid','partially_paid','paid','overpaid','refunded','unknown')),
  add column if not exists bank_reference text,
  add column if not exists matching_status text not null default 'unmatched'
    check(matching_status in ('complete','missing_documents','amount_mismatch','reference_mismatch','possible_duplicate','overpaid','underpaid','unmatched')),
  add column if not exists matched_document_ids uuid[] not null default '{}',
  add column if not exists risk_level text not null default 'low'
    check(risk_level in ('low','medium','high','critical')),
  add column if not exists risk_flags text[] not null default '{}',
  add column if not exists extraction_dimensions jsonb not null default '{}'::jsonb;

alter table public.accounting_document_lines
  add column if not exists expense_category text,
  add column if not exists cost_center_code text,
  add column if not exists wbs_code text;

create index if not exists accounting_documents_dimensions_idx
  on public.accounting_documents(company_id,flow_direction,lifecycle_stage,payment_status,document_date desc);
create index if not exists accounting_documents_expense_categories_idx
  on public.accounting_documents using gin(expense_categories);
create index if not exists accounting_documents_risk_flags_idx
  on public.accounting_documents using gin(risk_flags);

create table if not exists public.accounting_document_dimension_audit(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  source text not null check(source in ('ai_extraction','human_review','system_reconciliation')),
  before_dimensions jsonb,
  after_dimensions jsonb not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists accounting_document_dimension_audit_document_idx
  on public.accounting_document_dimension_audit(document_id,created_at desc);
alter table public.accounting_document_dimension_audit enable row level security;
create policy "Company managers read accounting dimension audit"
  on public.accounting_document_dimension_audit for select to authenticated
  using(public.is_company_manager(company_id));
revoke insert,update,delete on public.accounting_document_dimension_audit from anon,authenticated;
grant select on public.accounting_document_dimension_audit to authenticated;

comment on column public.accounting_documents.extraction_dimensions is
  'Complete AI/human multidimensional classification snapshot; searchable canonical dimensions remain in typed columns.';
notify pgrst,'reload schema';
