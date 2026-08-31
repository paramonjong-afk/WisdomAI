create extension if not exists pgcrypto;

create role anon nologin;
create role authenticated nologin;
create schema auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.profiles (
  id uuid primary key,
  full_name text,
  email text,
  role text not null check(role in ('admin', 'manager', 'employee'))
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

create table public.company_members (
  company_id uuid not null references public.companies(id),
  profile_id uuid not null references public.profiles(id),
  company_role text not null,
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  primary key(company_id, profile_id)
);

create or replace function public.is_company_manager(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.company_members member
    where member.company_id = target_company_id
      and member.profile_id = auth.uid()
      and member.active
      and member.company_role in ('company_admin', 'executive', 'manager')
      and (member.ends_on is null or member.ends_on >= current_date)
  );
$$;

create table public.projects (
  project_id uuid primary key default gen_random_uuid(),
  id uuid not null unique default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  code text,
  status text not null default 'active'
);

create table public.accounting_cost_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  parent_id uuid references public.accounting_cost_categories(id) on delete cascade,
  code text not null,
  name_th text not null,
  default_account_code text,
  default_account_name text,
  sort_order integer not null default 0,
  active boolean not null default true
);
create unique index accounting_cost_categories_global_code_uq
  on public.accounting_cost_categories(code) where company_id is null;
create unique index accounting_cost_categories_company_code_uq
  on public.accounting_cost_categories(company_id, code) where company_id is not null;

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  tax_id text
);

create table public.accounting_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(project_id),
  vendor_id uuid references public.vendors(id),
  document_number text,
  document_date date,
  vendor_name text,
  vendor_tax_id text,
  subtotal numeric(14,2),
  vat_amount numeric(14,2),
  withholding_tax_amount numeric(14,2),
  total_amount numeric(14,2),
  status text not null default 'pending',
  posting_status text not null default 'not_posted',
  updated_at timestamptz not null default now()
);

create table public.employee_advance_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(project_id),
  advance_number text not null,
  amount_received numeric(14,2) not null,
  status text not null default 'draft'
);

create table public.sales_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(project_id),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  budget_amount numeric(14,2) not null default 0,
  committed_amount numeric(14,2) not null default 0,
  actual_amount numeric(14,2) not null default 0,
  status text not null default 'draft',
  outcome_bucket text not null default 'pending_result',
  project_transfer_amount numeric(14,2) not null default 0,
  vendor_name text,
  evidence_reference text,
  note text,
  created_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_expenses_category_check check(category in (
    'site_survey', 'travel', 'design', 'estimating', 'sample_mockup',
    'tender_fee', 'presentation', 'commission', 'legal_consulting', 'other'
  )),
  constraint sales_expenses_status_check check(status in (
    'draft', 'pending', 'approved', 'paid', 'rejected', 'void'
  ))
);
alter table public.sales_expenses enable row level security;
create policy "Managers manage sales expenses" on public.sales_expenses
  for all to authenticated using(public.is_company_manager(company_id))
  with check(public.is_company_manager(company_id));
grant select, insert, update, delete on public.sales_expenses to authenticated;

create table public.accounting_draft_entries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.accounting_documents(id),
  line_number integer not null,
  account_code text not null,
  account_name text not null,
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  project_id uuid references public.projects(project_id),
  description text,
  unique(document_id, line_number)
);

create table public.project_cost_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code text not null,
  name_th text not null,
  active boolean not null default true,
  unique(company_id, code)
);

create table public.project_cost_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(project_id),
  cost_code_id uuid not null references public.project_cost_codes(id),
  source_sales_expense_id uuid unique references public.sales_expenses(id),
  cost_date date not null,
  description text not null,
  actual_amount numeric(14,2) not null default 0,
  forecast_amount numeric(14,2) not null default 0,
  status text not null,
  created_by uuid references public.profiles(id)
);
