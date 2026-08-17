-- Project commercial lifecycle, workforce allocation and cost analytics.

alter table public.employee_site_assignments
  add column if not exists allocation_note text;

create table if not exists public.employee_site_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.project_sites(id) on delete cascade,
  allocation_mode text not null check(allocation_mode in ('percent','fixed_amount')),
  allocation_value numeric(14,2) not null check(allocation_value>0),
  starts_on date not null default current_date,
  ends_on date,
  active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_on is null or ends_on>=starts_on),
  unique(profile_id,site_id,starts_on)
);

create or replace function public.validate_employee_site_cost_allocation()
returns trigger language plpgsql set search_path=public as $$
declare total numeric; salary numeric; modes integer;
begin
  if not new.active then return new; end if;
  select count(distinct allocation_mode),coalesce(sum(allocation_value),0)
    into modes,total
  from employee_site_cost_allocations allocation
  where allocation.profile_id=new.profile_id and allocation.active
    and allocation.id<>new.id
    and allocation.starts_on<=coalesce(new.ends_on,'infinity'::date)
    and coalesce(allocation.ends_on,'infinity'::date)>=new.starts_on;
  if modes>0 and exists(
    select 1 from employee_site_cost_allocations allocation
    where allocation.profile_id=new.profile_id and allocation.active and allocation.id<>new.id
      and allocation.allocation_mode<>new.allocation_mode
      and allocation.starts_on<=coalesce(new.ends_on,'infinity'::date)
      and coalesce(allocation.ends_on,'infinity'::date)>=new.starts_on
  ) then raise exception 'ช่วงเวลาเดียวกันต้องใช้รูปแบบจัดสรรแบบเดียวกัน'; end if;
  total:=total+new.allocation_value;
  if new.allocation_mode='percent' and total>100 then
    raise exception 'สัดส่วนรวมต้องไม่เกิน 100%%';
  end if;
  if new.allocation_mode='fixed_amount' then
    select monthly_salary into salary from employee_employment_records where profile_id=new.profile_id;
    if salary is null or salary<=0 then raise exception 'พนักงานยังไม่มีข้อมูลเงินเดือน'; end if;
    if total>salary then raise exception 'ยอดจัดสรรรวมต้องไม่เกินเงินเดือน'; end if;
  end if;
  new.updated_at:=now();
  return new;
end $$;

drop trigger if exists validate_employee_site_cost_allocation_trigger on public.employee_site_cost_allocations;
create trigger validate_employee_site_cost_allocation_trigger before insert or update
on public.employee_site_cost_allocations for each row execute function public.validate_employee_site_cost_allocation();

create table if not exists public.project_commercial_profiles (
  project_id uuid primary key references public.projects(project_id) on delete cascade,
  sales_status text not null default 'lead' check(sales_status in ('lead','estimating','proposal_sent','negotiation','won','lost','cancelled')),
  delivery_status text not null default 'not_started' check(delivery_status in ('not_started','ready','active','paused','construction_complete','warranty','closed')),
  expected_contract_value numeric(16,2) not null default 0 check(expected_contract_value>=0),
  win_probability numeric(5,2) not null default 0 check(win_probability between 0 and 100),
  sales_owner_id uuid references public.profiles(id) on delete set null,
  expected_start_on date,
  won_on date,
  lost_on date,
  status_reason text,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

insert into public.project_commercial_profiles(project_id,sales_status,delivery_status)
select project_id,
  case when status='active' then 'won' else 'lead' end,
  case status when 'active' then 'active' when 'paused' then 'paused' when 'completed' then 'construction_complete' when 'archived' then 'closed' else 'not_started' end
from public.projects on conflict(project_id) do nothing;

create table if not exists public.project_price_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(project_id) on delete cascade,
  revision_no integer not null check(revision_no>=0),
  title text not null,
  status text not null default 'draft' check(status in ('draft','review','sent','customer_revision','approved','rejected','cancelled')),
  amount_before_vat numeric(16,2) not null default 0 check(amount_before_vat>=0),
  vat_amount numeric(16,2) not null default 0 check(vat_amount>=0),
  total_amount numeric(16,2) generated always as (amount_before_vat+vat_amount) stored,
  reason text,
  boq_document_id uuid references public.boq_documents(id) on delete set null,
  sent_at timestamptz,
  accepted_at timestamptz,
  locked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,revision_no)
);

create or replace function public.lock_approved_price_revision()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.locked_at is not null and to_jsonb(new)-'updated_at'<>to_jsonb(old)-'updated_at' then
    raise exception 'Revision ที่ยืนยันเป็นฉบับสัญญาแล้วไม่สามารถแก้ไขได้';
  end if;
  if new.status='approved' and old.status is distinct from 'approved' then
    new.accepted_at:=coalesce(new.accepted_at,now()); new.locked_at:=coalesce(new.locked_at,now());
  end if;
  new.updated_at:=now(); return new;
end $$;
drop trigger if exists lock_approved_price_revision_trigger on public.project_price_revisions;
create trigger lock_approved_price_revision_trigger before update on public.project_price_revisions
for each row execute function public.lock_approved_price_revision();

create table if not exists public.sales_expenses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(project_id) on delete cascade,
  price_revision_id uuid references public.project_price_revisions(id) on delete set null,
  expense_date date not null default current_date,
  category text not null check(category in ('site_survey','travel','design','estimating','sample_mockup','tender_fee','presentation','commission','legal_consulting','other')),
  description text not null,
  budget_amount numeric(14,2) not null default 0 check(budget_amount>=0),
  committed_amount numeric(14,2) not null default 0 check(committed_amount>=0),
  actual_amount numeric(14,2) not null default 0 check(actual_amount>=0),
  status text not null default 'draft' check(status in ('draft','pending','approved','paid','rejected','void')),
  outcome_bucket text not null default 'pending_result' check(outcome_bucket in ('pending_result','project_cost','selling_expense','lost_bid','customer_recoverable')),
  project_transfer_amount numeric(14,2) not null default 0 check(project_transfer_amount>=0),
  vendor_name text,
  evidence_reference text,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(project_transfer_amount<=greatest(budget_amount,committed_amount,actual_amount))
);

create table if not exists public.project_cost_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.project_cost_codes(code,name_th,sort_order) values
('01','วัสดุ',1),('02','แรงงานตรง',2),('03','ผู้รับเหมา/ผู้รับเหมาช่วง',3),
('04','เครื่องจักรและเครื่องมือ',4),('05','ขนส่งและโลจิสติกส์',5),
('06','ค่าใช้จ่ายประจำไซต์',6),('07','ออกแบบและวิชาชีพ',7),
('08','คุณภาพ ความปลอดภัย และสิ่งแวดล้อม',8),('09','การเงิน ประกัน และสัญญา',9),
('10','บริหารโครงการและต้นทุนก่อนเริ่มงาน',10)
on conflict(code) do update set name_th=excluded.name_th,sort_order=excluded.sort_order,active=true;

create table if not exists public.project_cost_entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(project_id) on delete cascade,
  site_id uuid references public.project_sites(id) on delete set null,
  cost_code_id uuid not null references public.project_cost_codes(id),
  boq_item_id uuid references public.boq_items(id) on delete set null,
  source_sales_expense_id uuid unique references public.sales_expenses(id) on delete set null,
  cost_date date not null default current_date,
  description text not null,
  phase text,
  area text,
  cause text not null default 'planned' check(cause in ('planned','variation','rework','waste','delay','warranty','other')),
  budget_amount numeric(14,2) not null default 0 check(budget_amount>=0),
  committed_amount numeric(14,2) not null default 0 check(committed_amount>=0),
  actual_amount numeric(14,2) not null default 0 check(actual_amount>=0),
  forecast_amount numeric(14,2) not null default 0 check(forecast_amount>=0),
  status text not null default 'draft' check(status in ('draft','pending','approved','posted','void')),
  vendor_name text,
  evidence_reference text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.transfer_sales_expense_to_project_cost(
  target_expense_id uuid,target_cost_code_id uuid,target_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare expense sales_expenses; entry_id uuid; maximum numeric;
begin
  if not public.is_work_manager() then raise exception 'Permission denied'; end if;
  select * into expense from sales_expenses where id=target_expense_id for update;
  if not found then raise exception 'ไม่พบรายการค่าใช้จ่ายขาย'; end if;
  if expense.outcome_bucket='lost_bid' then raise exception 'งานที่ขายไม่สำเร็จไม่สามารถโอนเป็นต้นทุนโครงการ'; end if;
  maximum:=greatest(expense.budget_amount,expense.committed_amount,expense.actual_amount);
  if target_amount<=0 or target_amount>maximum then raise exception 'ยอดโอนไม่ถูกต้อง'; end if;
  insert into project_cost_entries(project_id,cost_code_id,source_sales_expense_id,cost_date,description,actual_amount,forecast_amount,status,created_by)
  values(expense.project_id,target_cost_code_id,expense.id,expense.expense_date,'โอนจากค่าใช้จ่ายขาย: '||expense.description,target_amount,target_amount,'approved',auth.uid())
  returning id into entry_id;
  update sales_expenses set outcome_bucket='project_cost',project_transfer_amount=target_amount,updated_at=now() where id=expense.id;
  return entry_id;
end $$;
grant execute on function public.transfer_sales_expense_to_project_cost(uuid,uuid,numeric) to authenticated;

alter table public.employee_site_cost_allocations enable row level security;
alter table public.project_commercial_profiles enable row level security;
alter table public.project_price_revisions enable row level security;
alter table public.sales_expenses enable row level security;
alter table public.project_cost_codes enable row level security;
alter table public.project_cost_entries enable row level security;

create policy "Managers manage salary site allocations" on public.employee_site_cost_allocations for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage project commercial profiles" on public.project_commercial_profiles for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage project price revisions" on public.project_price_revisions for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage sales expenses" on public.sales_expenses for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Authenticated read project cost codes" on public.project_cost_codes for select to authenticated using(active or public.is_work_manager());
create policy "Managers manage project cost codes" on public.project_cost_codes for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());
create policy "Managers manage project cost entries" on public.project_cost_entries for all to authenticated using(public.is_work_manager()) with check(public.is_work_manager());

create index if not exists employee_site_cost_allocations_profile_idx on public.employee_site_cost_allocations(profile_id,active);
create index if not exists project_price_revisions_project_idx on public.project_price_revisions(project_id,revision_no desc);
create index if not exists sales_expenses_project_idx on public.sales_expenses(project_id,expense_date desc);
create index if not exists project_cost_entries_project_idx on public.project_cost_entries(project_id,cost_date desc);
