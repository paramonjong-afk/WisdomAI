create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  tax_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_role text not null default 'employee' check (company_role in ('company_admin','executive','manager','site_supervisor','accounting_hr','employee')),
  active boolean not null default true,
  starts_on date not null default current_date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id, profile_id),
  check(ends_on is null or ends_on >= starts_on)
);

create table if not exists public.user_company_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  active_company_id uuid not null references public.companies(id) on delete cascade,
  updated_at timestamptz not null default now()
);

insert into public.companies(name,slug)
values ('WisdomAI Construction','wisdomai-default')
on conflict(slug) do nothing;

insert into public.company_members(company_id,profile_id,company_role)
select c.id,p.id,case p.role when 'admin' then 'company_admin' when 'manager' then 'manager' else 'employee' end
from public.companies c cross join public.profiles p
where c.slug='wisdomai-default'
on conflict(company_id,profile_id) do update set active=true;

insert into public.user_company_preferences(profile_id,active_company_id)
select p.id,c.id from public.profiles p cross join public.companies c where c.slug='wisdomai-default'
on conflict(profile_id) do nothing;

create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path=public
as $$
  select coalesce(
    (select u.active_company_id from public.user_company_preferences u
      join public.company_members m on m.company_id=u.active_company_id and m.profile_id=u.profile_id
      where u.profile_id=auth.uid() and m.active and (m.ends_on is null or m.ends_on>=current_date)),
    (select m.company_id from public.company_members m
      where m.profile_id=auth.uid() and m.active and (m.ends_on is null or m.ends_on>=current_date)
      order by m.created_at limit 1)
  );
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active and (m.ends_on is null or m.ends_on>=current_date)); $$;

create or replace function public.is_company_manager(target_company_id uuid default public.current_company_id())
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active and m.company_role in ('company_admin','executive','manager') and (m.ends_on is null or m.ends_on>=current_date)); $$;

create or replace function public.get_my_companies()
returns table(company_id uuid,company_name text,company_slug text,company_role text,is_active boolean)
language sql stable security definer set search_path=public
as $$
  select c.id,c.name,c.slug,m.company_role,(c.id=public.current_company_id())
  from public.company_members m join public.companies c on c.id=m.company_id
  where m.profile_id=auth.uid() and m.active and c.active and (m.ends_on is null or m.ends_on>=current_date)
  order by 5 desc,c.name;
$$;

create or replace function public.switch_company(target_company_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_company_member(target_company_id) then raise exception 'ไม่มีสิทธิ์ใช้งานบริษัทนี้'; end if;
  insert into public.user_company_preferences(profile_id,active_company_id,updated_at)
  values(auth.uid(),target_company_id,now())
  on conflict(profile_id) do update set active_company_id=excluded.active_company_id,updated_at=now();
end;
$$;

create or replace function public.add_company_member(member_email text,member_role text default 'employee')
returns void language plpgsql security definer set search_path=public
as $$
declare target_profile_id uuid; target_company_id uuid:=public.current_company_id();
begin
  if not public.is_company_manager(target_company_id) then raise exception 'ไม่มีสิทธิ์จัดการสมาชิกบริษัท'; end if;
  if member_role not in ('company_admin','executive','manager','site_supervisor','accounting_hr','employee') then raise exception 'บทบาทไม่ถูกต้อง'; end if;
  select id into target_profile_id from public.profiles where lower(email)=lower(trim(member_email)) limit 1;
  if target_profile_id is null then raise exception 'ไม่พบบัญชีผู้ใช้อีเมลนี้'; end if;
  insert into public.company_members(company_id,profile_id,company_role,active)
  values(target_company_id,target_profile_id,member_role,true)
  on conflict(company_id,profile_id) do update set company_role=excluded.company_role,active=true,updated_at=now();
  insert into public.user_company_preferences(profile_id,active_company_id)
  values(target_profile_id,target_company_id) on conflict(profile_id) do nothing;
end;
$$;

create or replace function public.assign_current_company()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  if new.company_id is null then new.company_id:=public.current_company_id(); end if;
  if new.company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนบันทึกข้อมูล'; end if;
  if auth.uid() is not null and not public.is_company_member(new.company_id) then raise exception 'ไม่มีสิทธิ์บันทึกข้อมูลบริษัทนี้'; end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'projects','project_members','project_sites','employee_site_assignments','attendance_sessions',
    'line_groups','line_senders','line_messages','line_attachments','work_summary_items','line_message_projects','line_ingestion_events',
    'vendors','accounting_documents','accounting_document_lines','inventory_items','inventory_movements','accounting_draft_entries','financial_transactions','vendor_product_prices',
    'attendance_correction_requests','attendance_audit_logs','employee_pay_adjustments','boq_documents','boq_items',
    'drawing_ai_jobs','drawing_ai_runs','drawing_ai_ground_truth','drawing_ai_scores','drawing_ai_module_runs','drawing_sheets','drawing_takeoff_scopes','drawing_sheet_dependencies','drawing_sheet_items','cost_reference_prices','boq_item_price_decisions','boq_item_price_decision_history',
    'employee_personal_data_stewards','employee_private_profiles','employee_identity_documents','employee_document_extractions','employee_emergency_contacts','employee_personal_data_authorizations','employee_personal_data_access_logs',
    'work_policies','company_holidays','employee_employment_records','employee_line_accounts','leave_types','employee_leave_balances','employee_leave_requests','employee_overtime_assignments','pay_periods','employee_payrolls','employee_payroll_lines','employee_payslips','employee_document_requests','employee_qualifications','employee_training_records','employee_asset_assignments','employee_lifecycle_cases','employee_lifecycle_tasks','employee_workforce_audit_logs',
    'image_review_cases','wisdom_image_learning_samples','image_ai_observations','image_review_field_checks','online_training_sources','online_training_queue',
    'attendance_system_settings','attendance_notifications','pay_cycle_settings','contractor_vendors','contractor_contracts','contractor_payment_claims','notification_read_states','workforce_rule_settings','attendance_reminder_events',
    'employee_site_cost_allocations','project_commercial_profiles','project_price_revisions','sales_expenses','project_cost_codes','project_cost_entries'
  ] loop
    if to_regclass('public.'||table_name) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id)',table_name);
      execute format('update public.%I set company_id=(select id from public.companies where slug=''wisdomai-default'') where company_id is null',table_name);
      execute format('alter table public.%I alter column company_id set not null',table_name);
      execute format('create index if not exists %I on public.%I(company_id)',table_name||'_company_idx',table_name);
      execute format('drop trigger if exists %I on public.%I','assign_company_'||table_name,table_name);
      execute format('create trigger %I before insert on public.%I for each row execute function public.assign_current_company()','assign_company_'||table_name,table_name);
      execute format('alter table public.%I enable row level security',table_name);
      execute format('drop policy if exists %I on public.%I','tenant_isolation_'||table_name,table_name);
      execute format('create policy %I on public.%I as restrictive for all to authenticated using (company_id=public.current_company_id()) with check (company_id=public.current_company_id())','tenant_isolation_'||table_name,table_name);
    end if;
  end loop;
end $$;

-- เลขอ้างอิงที่ผู้ใช้กำหนดเองต้องซ้ำได้คนละบริษัท
alter table public.projects drop constraint if exists projects_code_key;
create unique index if not exists projects_company_code_key on public.projects(company_id,upper(code)) where code is not null;
alter table public.employee_employment_records drop constraint if exists employee_employment_records_employee_code_key;
create unique index if not exists employee_company_code_key on public.employee_employment_records(company_id,upper(employee_code)) where employee_code is not null;
alter table public.work_policies drop constraint if exists work_policies_name_key;
create unique index if not exists work_policies_company_name_key on public.work_policies(company_id,lower(name));
alter table public.leave_types drop constraint if exists leave_types_code_key;
create unique index if not exists leave_types_company_code_key on public.leave_types(company_id,lower(code));
alter table public.project_cost_codes drop constraint if exists project_cost_codes_code_key;
create unique index if not exists project_cost_codes_company_code_key on public.project_cost_codes(company_id,code);
alter table public.contractor_contracts drop constraint if exists contractor_contracts_contract_number_key;
create unique index if not exists contractor_contracts_company_number_key on public.contractor_contracts(company_id,contract_number);
alter table public.employee_payslips drop constraint if exists employee_payslips_document_number_key;
create unique index if not exists employee_payslips_company_document_key on public.employee_payslips(company_id,document_number);

create or replace function public.create_company(company_name text,company_slug text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare new_company_id uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if nullif(trim(company_name),'') is null or nullif(trim(company_slug),'') is null then raise exception 'กรุณาระบุชื่อและรหัสบริษัท'; end if;
  insert into public.companies(name,slug) values(trim(company_name),lower(trim(company_slug))) returning id into new_company_id;
  insert into public.company_members(company_id,profile_id,company_role) values(new_company_id,auth.uid(),'company_admin');
  insert into public.user_company_preferences(profile_id,active_company_id,updated_at) values(auth.uid(),new_company_id,now())
  on conflict(profile_id) do update set active_company_id=excluded.active_company_id,updated_at=now();
  insert into public.project_cost_codes(company_id,code,name_th,sort_order)
  select new_company_id,code,name_th,sort_order from public.project_cost_codes
  where company_id=(select id from public.companies where slug='wisdomai-default')
  on conflict(company_id,code) do nothing;
  return new_company_id;
end;
$$;

create or replace function public.sync_legacy_project_status()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  update public.projects set status=case
    when new.delivery_status='paused' then 'paused'
    when new.delivery_status in ('construction_complete','warranty') then 'completed'
    when new.delivery_status='closed' then 'archived'
    else 'active' end,
    updated_at=now()
  where project_id=new.project_id and company_id=new.company_id;
  return new;
end;
$$;
drop trigger if exists sync_project_status_from_commercial on public.project_commercial_profiles;
create trigger sync_project_status_from_commercial after insert or update of delivery_status on public.project_commercial_profiles
for each row execute function public.sync_legacy_project_status();

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.user_company_preferences enable row level security;
create policy "Members read companies" on public.companies for select to authenticated using(public.is_company_member(id));
create policy "Members read memberships" on public.company_members for select to authenticated using(profile_id=auth.uid() or public.is_company_manager(company_id));
create policy "Company admins manage memberships" on public.company_members for all to authenticated using(public.is_company_manager(company_id)) with check(public.is_company_manager(company_id));
create policy "Users read own company preference" on public.user_company_preferences for select to authenticated using(profile_id=auth.uid());

grant execute on function public.get_my_companies() to authenticated;
grant execute on function public.switch_company(uuid) to authenticated;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.create_company(text,text) to authenticated;
grant execute on function public.add_company_member(text,text) to authenticated;
