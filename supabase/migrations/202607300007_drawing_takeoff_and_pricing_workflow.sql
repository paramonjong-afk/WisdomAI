-- WisdomAI staged drawing takeoff and auditable material/labour pricing.

alter table public.drawing_ai_jobs drop constraint if exists drawing_ai_jobs_status_check;
alter table public.drawing_ai_jobs add constraint drawing_ai_jobs_status_check
  check (status in (
    'queued','processing','indexing','awaiting_scope','taking_off',
    'awaiting_review','completed','partial','failed','needs_project','verified'
  ));

create table if not exists public.work_systems (
  code text primary key,
  name_th text not null,
  name_en text not null,
  sort_order integer not null,
  active boolean not null default true
);

insert into public.work_systems(code, name_th, name_en, sort_order) values
  ('AR','สถาปัตยกรรม','Architectural',10),
  ('ST','โครงสร้าง','Structural',20),
  ('CV','โยธาและงานภายนอก','Civil and external works',30),
  ('EL','ไฟฟ้ากำลัง','Electrical power',40),
  ('LT','ไฟฟ้าสื่อสารและแรงต่ำ','Low current',50),
  ('FA','แจ้งเหตุเพลิงไหม้','Fire alarm',60),
  ('PL','ประปาและสุขาภิบาล','Plumbing and sanitary',70),
  ('FP','ดับเพลิง','Fire protection',80),
  ('AC','ปรับอากาศและระบายอากาศ','HVAC',90),
  ('VT','ระบบขนส่ง','Vertical transportation',100),
  ('SOL','โซลาร์และพลังงาน','Solar and energy',110),
  ('MED','ก๊าซทางการแพทย์','Medical gas',120),
  ('SC','ระบบควบคุมอาคาร','Building controls',130),
  ('LA','ภูมิทัศน์','Landscape',140),
  ('TM','งานชั่วคราวและงานทั่วไป','Temporary and general works',150)
on conflict (code) do update set
  name_th = excluded.name_th, name_en = excluded.name_en,
  sort_order = excluded.sort_order, active = true;

create table if not exists public.work_categories (
  code text primary key,
  system_code text not null references public.work_systems(code),
  name_th text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.drawing_sheets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  sheet_number text,
  title text,
  revision text,
  discipline_code text references public.work_systems(code),
  sheet_role text not null default 'unknown'
    check (sheet_role in ('cover','index','plan','legend','schedule','detail','section','riser','sld','typical','specification','unknown')),
  building text,
  floor text,
  zone text,
  scale text,
  evidence text,
  confidence numeric(5,4) check (confidence between 0 and 1),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, page_number)
);

create table if not exists public.drawing_takeoff_scopes (
  job_id uuid primary key references public.drawing_ai_jobs(id) on delete cascade,
  output_system_codes text[] not null check (cardinality(output_system_codes) > 0),
  status text not null default 'selected'
    check (status in ('selected','processing','review','approved')),
  selected_by uuid references public.profiles(id) on delete set null,
  selected_at timestamptz not null default now(),
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.drawing_sheet_dependencies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  output_system_code text not null references public.work_systems(code),
  sheet_id uuid not null references public.drawing_sheets(id) on delete cascade,
  dependency_type text not null
    check (dependency_type in ('primary','route','level','room_boundary','ceiling','clash','specification','connectivity','assembly')),
  reason text not null,
  auto_selected boolean not null default true,
  created_at timestamptz not null default now(),
  unique(job_id, output_system_code, sheet_id, dependency_type)
);

create table if not exists public.drawing_sheet_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  sheet_id uuid references public.drawing_sheets(id) on delete set null,
  page_number integer not null check (page_number > 0),
  system_code text references public.work_systems(code),
  category_code text references public.work_categories(code),
  item_code text,
  description text not null,
  specification text,
  unit text,
  quantity numeric(16,4) check (quantity >= 0),
  building text,
  floor text,
  zone text,
  room text,
  count_method text not null default 'plan'
    check (count_method in ('plan','schedule','detail','riser','calculated_route','typical_multiplier','manual')),
  source_role text not null default 'plan',
  bbox jsonb,
  evidence text not null default '',
  confidence numeric(5,4) check (confidence between 0 and 1),
  duplicate_group_key text,
  review_status text not null default 'pending'
    check (review_status in ('pending','accepted','rejected','needs_review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drawing_sheets_job_idx on public.drawing_sheets(job_id, page_number);
create index if not exists drawing_sheet_items_trace_idx
  on public.drawing_sheet_items(job_id, system_code, building, floor, zone, room, page_number);

create table if not exists public.cost_reference_prices (
  id uuid primary key default gen_random_uuid(),
  cost_kind text not null check (cost_kind in ('material','labour')),
  item_code text,
  description text not null,
  specification text,
  unit text not null,
  source_type text not null
    check (source_type in ('actual_purchase','actual_labour','cgd_reference','wisdom_reference','vendor_quotation','manual')),
  source_name text not null,
  source_reference text,
  effective_date date not null,
  province text,
  quantity_from numeric(16,4),
  quantity_to numeric(16,4),
  unit_price numeric(16,4) not null check (unit_price >= 0),
  vat_included boolean not null default false,
  transport_included boolean not null default false,
  currency text not null default 'THB',
  evidence_url text,
  evidence_metadata jsonb,
  verified boolean not null default false,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_reference_match_idx
  on public.cost_reference_prices(cost_kind, item_code, unit, effective_date desc);

create table if not exists public.boq_item_price_decisions (
  id uuid primary key default gen_random_uuid(),
  boq_item_id uuid not null references public.boq_items(id) on delete cascade,
  cost_kind text not null check (cost_kind in ('material','labour')),
  latest_actual_price numeric(16,4),
  government_reference_price numeric(16,4),
  comparable_min_price numeric(16,4),
  comparable_max_price numeric(16,4),
  ai_recommended_price numeric(16,4),
  ai_confidence numeric(5,4) check (ai_confidence between 0 and 1),
  ai_reason text,
  sale_decided_price numeric(16,4),
  sale_reason text,
  status text not null default 'awaiting_sale'
    check (status in ('awaiting_data','awaiting_sale','sale_confirmed','approved')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  analysis_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(boq_item_id, cost_kind)
);

create table if not exists public.boq_item_price_decision_history (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.boq_item_price_decisions(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  previous_value jsonb,
  new_value jsonb not null,
  changed_at timestamptz not null default now()
);

create or replace function public.audit_boq_price_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.boq_item_price_decision_history(decision_id, changed_by, previous_value, new_value)
  values (new.id, auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists audit_boq_price_decision_change on public.boq_item_price_decisions;
create trigger audit_boq_price_decision_change
after insert or update on public.boq_item_price_decisions
for each row execute function public.audit_boq_price_decision();

create or replace view public.cost_reference_price_summary
with (security_invoker = true) as
select
  cost_kind, item_code, lower(regexp_replace(description, '\s+', ' ', 'g')) as normalized_description,
  specification, unit, province,
  min(unit_price)::numeric(16,4) as min_price,
  max(unit_price)::numeric(16,4) as max_price,
  avg(unit_price)::numeric(16,4) as average_price,
  count(*)::integer as source_count,
  max(effective_date) as latest_date,
  (array_agg(unit_price order by effective_date desc, created_at desc))[1]::numeric(16,4) as latest_price
from public.cost_reference_prices
where verified
group by cost_kind, item_code, lower(regexp_replace(description, '\s+', ' ', 'g')),
  specification, unit, province;

alter table public.work_systems enable row level security;
alter table public.work_categories enable row level security;
alter table public.drawing_sheets enable row level security;
alter table public.drawing_takeoff_scopes enable row level security;
alter table public.drawing_sheet_dependencies enable row level security;
alter table public.drawing_sheet_items enable row level security;
alter table public.cost_reference_prices enable row level security;
alter table public.boq_item_price_decisions enable row level security;
alter table public.boq_item_price_decision_history enable row level security;

create policy "Authenticated users read work systems" on public.work_systems for select to authenticated using (true);
create policy "Authenticated users read work categories" on public.work_categories for select to authenticated using (true);
create policy "Authenticated users read drawing sheets" on public.drawing_sheets for select to authenticated using (true);
create policy "Authenticated users read takeoff scopes" on public.drawing_takeoff_scopes for select to authenticated using (true);
create policy "Authenticated users read drawing dependencies" on public.drawing_sheet_dependencies for select to authenticated using (true);
create policy "Authenticated users read sheet items" on public.drawing_sheet_items for select to authenticated using (true);
create policy "Authenticated users read cost references" on public.cost_reference_prices for select to authenticated using (true);
create policy "Authenticated users read BOQ price decisions" on public.boq_item_price_decisions for select to authenticated using (true);
create policy "Authenticated users read BOQ price history" on public.boq_item_price_decision_history for select to authenticated using (true);

create policy "Managers maintain drawing sheets" on public.drawing_sheets for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain takeoff scopes" on public.drawing_takeoff_scopes for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain drawing dependencies" on public.drawing_sheet_dependencies for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain sheet items" on public.drawing_sheet_items for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain cost references" on public.cost_reference_prices for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain BOQ price decisions" on public.boq_item_price_decisions for all to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());

grant select on public.cost_reference_price_summary to authenticated;

comment on table public.drawing_sheet_items is
  'Auditable takeoff at sheet/building/floor/zone/room grain. Consolidation must retain these source rows.';
comment on table public.boq_item_price_decisions is
  'Material and labour are decided independently. BOQ uses the Sale-decided value; AI never silently finalizes a selling cost.';
