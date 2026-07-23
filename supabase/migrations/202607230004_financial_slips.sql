create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null unique references public.line_messages(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  recipient_name text,
  amount_total numeric(14, 2),
  labor_amount numeric(14, 2),
  materials_amount numeric(14, 2),
  expense_type text not null default 'unknown'
    check (expense_type in ('labor', 'materials_equipment', 'mixed', 'advance', 'unknown')),
  transfer_at timestamptz,
  bank_reference text,
  currency text not null default 'THB',
  image_sha256 text not null,
  dedupe_key text,
  duplicate_of uuid references public.financial_transactions(id) on delete set null,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed', 'duplicate', 'dismissed')),
  notes text,
  analysis_provider text not null default 'gemini',
  analysis_model text,
  analysis_confidence numeric(4, 3),
  analysis_error text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_total is null or amount_total >= 0),
  check (labor_amount is null or labor_amount >= 0),
  check (materials_amount is null or materials_amount >= 0),
  check (duplicate_of is null or review_status = 'duplicate')
);

create index if not exists financial_transactions_created_idx
  on public.financial_transactions(created_at desc);
create index if not exists financial_transactions_project_idx
  on public.financial_transactions(project_id, transfer_at desc);
create index if not exists financial_transactions_image_hash_idx
  on public.financial_transactions(image_sha256);
create index if not exists financial_transactions_dedupe_idx
  on public.financial_transactions(dedupe_key)
  where dedupe_key is not null;

alter table public.financial_transactions enable row level security;

create policy "Authenticated users can read financial transactions"
  on public.financial_transactions for select to authenticated using (true);

create policy "Managers can review financial transactions"
  on public.financial_transactions for update to authenticated
  using (public.is_work_manager())
  with check (public.is_work_manager());

comment on table public.financial_transactions is
  'Transfer-slip evidence extracted from LINE images. Duplicate rows remain for audit but are excluded from confirmed totals.';
comment on column public.financial_transactions.expense_type is
  'Classification depends on payment purpose, not recipient identity. Employees may receive labor, materials, mixed, or advance payments.';
comment on column public.financial_transactions.dedupe_key is
  'Cross-group duplicate candidate key using bank reference when available, otherwise the image SHA-256.';
