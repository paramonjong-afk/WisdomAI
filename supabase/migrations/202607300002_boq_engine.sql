create table if not exists public.boq_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  document_number text not null,
  title text not null,
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'superseded')),
  customer_name text,
  site_name text,
  overhead_percent numeric(7,3) not null default 0 check (overhead_percent >= 0),
  profit_percent numeric(7,3) not null default 0 check (profit_percent >= 0),
  discount_amount numeric(16,2) not null default 0 check (discount_amount >= 0),
  vat_percent numeric(7,3) not null default 7 check (vat_percent >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, document_number, revision)
);

create table if not exists public.boq_items (
  id uuid primary key default gen_random_uuid(),
  boq_document_id uuid not null references public.boq_documents(id) on delete cascade,
  parent_id uuid references public.boq_items(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  boq_code text not null,
  category text not null,
  description text not null,
  specification text,
  unit text not null,
  quantity numeric(16,4) not null default 0 check (quantity >= 0),
  material_unit_cost numeric(16,4) not null default 0 check (material_unit_cost >= 0),
  labour_unit_cost numeric(16,4) not null default 0 check (labour_unit_cost >= 0),
  equipment_unit_cost numeric(16,4) not null default 0 check (equipment_unit_cost >= 0),
  subcontract_unit_cost numeric(16,4) not null default 0 check (subcontract_unit_cost >= 0),
  indirect_unit_cost numeric(16,4) not null default 0 check (indirect_unit_cost >= 0),
  selling_unit_price numeric(16,4) not null default 0 check (selling_unit_price >= 0),
  planned_hours numeric(12,2) not null default 0 check (planned_hours >= 0),
  actual_hours numeric(12,2) not null default 0 check (actual_hours >= 0),
  progress_percent numeric(5,2) not null default 0 check (progress_percent between 0 and 100),
  work_status text not null default 'not_started'
    check (work_status in ('not_started', 'in_progress', 'completed', 'blocked')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'import', 'assembly', 'drawing_ai')),
  source_reference jsonb,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (boq_document_id, line_number),
  unique (boq_document_id, boq_code)
);

create index if not exists boq_documents_project_idx
  on public.boq_documents(project_id, updated_at desc);
create index if not exists boq_items_document_idx
  on public.boq_items(boq_document_id, line_number);

alter table public.boq_documents enable row level security;
alter table public.boq_items enable row level security;

create policy "Authenticated users read BOQ documents" on public.boq_documents
  for select to authenticated using (true);
create policy "Authenticated users read BOQ items" on public.boq_items
  for select to authenticated using (true);
create policy "Managers maintain BOQ documents" on public.boq_documents
  for all to authenticated using (public.is_work_manager())
  with check (public.is_work_manager());
create policy "Managers maintain BOQ items" on public.boq_items
  for all to authenticated using (
    public.is_work_manager() and exists (
      select 1 from public.boq_documents d
      where d.id = boq_document_id and d.status <> 'approved'
    )
  )
  with check (
    public.is_work_manager() and exists (
      select 1 from public.boq_documents d
      where d.id = boq_document_id and d.status <> 'approved'
    )
  );

create or replace view public.boq_document_totals
with (security_invoker = true)
as
select
  d.id,
  coalesce(sum(i.quantity * i.material_unit_cost), 0)::numeric(16,2) as material_cost,
  coalesce(sum(i.quantity * i.labour_unit_cost), 0)::numeric(16,2) as labour_cost,
  coalesce(sum(i.quantity * i.equipment_unit_cost), 0)::numeric(16,2) as equipment_cost,
  coalesce(sum(i.quantity * i.subcontract_unit_cost), 0)::numeric(16,2) as subcontract_cost,
  coalesce(sum(i.quantity * i.indirect_unit_cost), 0)::numeric(16,2) as indirect_cost,
  coalesce(sum(i.quantity * (
    i.material_unit_cost + i.labour_unit_cost + i.equipment_unit_cost +
    i.subcontract_unit_cost + i.indirect_unit_cost
  )), 0)::numeric(16,2) as direct_cost,
  coalesce(sum(i.quantity * i.selling_unit_price), 0)::numeric(16,2) as item_selling_total
from public.boq_documents d
left join public.boq_items i on i.boq_document_id = d.id
group by d.id;

comment on table public.boq_documents is 'Versioned BOQ cost baselines for projects.';
comment on column public.boq_items.source_reference is
  'Evidence for imported/AI takeoff items, e.g. file, drawing page, scale and bounding box.';
