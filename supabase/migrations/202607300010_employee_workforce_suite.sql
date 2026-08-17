-- Integrated workforce operations: employment, schedules, leave, OT, payroll,
-- payslips, document requests, qualifications, training, assets and offboarding.

create table if not exists public.work_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  timezone text not null default 'Asia/Bangkok',
  work_start_time time not null default time '08:00',
  work_end_time time not null default time '17:00',
  break_start_time time not null default time '12:00',
  break_end_time time not null default time '13:00',
  grace_minutes integer not null default 5 check (grace_minutes between 0 and 120),
  standard_minutes integer not null default 480 check (standard_minutes between 1 and 1440),
  overtime_round_minutes integer not null default 15 check (overtime_round_minutes in (1, 5, 10, 15, 30, 60)),
  work_weekdays integer[] not null default array[1,2,3,4,5,6],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.work_policies(name) values ('เวลางานมาตรฐาน 08:00-17:00')
on conflict (name) do nothing;

alter table public.project_sites
  add column if not exists work_policy_id uuid references public.work_policies(id) on delete set null;

update public.project_sites
set work_policy_id = (select id from public.work_policies where active order by created_at limit 1)
where work_policy_id is null;

create table if not exists public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  site_id uuid references public.project_sites(id) on delete cascade,
  paid boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (holiday_date, site_id)
);

create table if not exists public.employee_employment_records (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  employee_code text unique,
  employment_type text not null default 'daily'
    check (employment_type in ('daily','monthly','temporary','contractor')),
  job_title text,
  department text,
  supervisor_id uuid references public.profiles(id) on delete set null,
  work_policy_id uuid references public.work_policies(id) on delete set null,
  hired_on date,
  probation_ends_on date,
  contract_ends_on date,
  terminated_on date,
  employment_status text not null default 'active'
    check (employment_status in ('preboarding','probation','active','suspended','notice','terminated','archived')),
  daily_rate numeric(12,2) not null default 0 check (daily_rate >= 0),
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  overtime_hourly_rate numeric(12,2) not null default 0 check (overtime_hourly_rate >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.employee_employment_records(
  profile_id, employee_code, employment_type, hired_on, terminated_on,
  employment_status, daily_rate, monthly_salary, overtime_hourly_rate
)
select
  profile.id,
  'EMP-' || upper(left(replace(profile.id::text,'-',''),8)),
  profile.employment_type,
  null,
  null,
  'active',
  profile.daily_rate,
  profile.monthly_salary,
  profile.ot_hourly_rate
from public.profiles profile
on conflict(profile_id) do nothing;

create table if not exists public.employee_line_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  line_user_id text not null unique references public.line_senders(line_user_id) on delete cascade,
  verified_at timestamptz not null,
  verified_by uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_th text not null,
  paid_ratio numeric(4,3) not null default 1 check (paid_ratio between 0 and 1),
  annual_quota_minutes integer,
  advance_notice_hours integer not null default 24 check (advance_notice_hours >= 0),
  evidence_required_after_minutes integer,
  allow_emergency boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.leave_types(code,name_th,paid_ratio,annual_quota_minutes,advance_notice_hours,evidence_required_after_minutes,allow_emergency)
values
  ('sick','ลาป่วย',1,14400,0,960,true),
  ('personal','ลากิจ',1,2880,24,null,true),
  ('annual','ลาพักร้อน',1,4800,72,null,false),
  ('unpaid','ลาไม่รับค่าจ้าง',0,null,24,null,true),
  ('maternity','ลาคลอด',1,null,168,null,true)
on conflict (code) do nothing;

create table if not exists public.employee_leave_balances (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  balance_year integer not null,
  granted_minutes integer not null default 0,
  used_minutes integer not null default 0,
  pending_minutes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(profile_id, leave_type_id, balance_year),
  check (granted_minutes >= 0 and used_minutes >= 0 and pending_minutes >= 0)
);

create table if not exists public.employee_leave_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  requested_minutes integer not null check (requested_minutes > 0),
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  evidence_path text,
  status text not null default 'pending'
    check (status in ('draft','pending','needs_evidence','approved','rejected','cancelled','used','late_notice')),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists employee_leave_profile_date_idx
  on public.employee_leave_requests(profile_id, starts_at, ends_at);

create table if not exists public.employee_overtime_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid references public.project_sites(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  status text not null default 'assigned'
    check (status in ('draft','assigned','acknowledged','pending_approval','approved','rejected','cancelled')),
  assigned_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  approved_minutes integer check (approved_minutes is null or approved_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists employee_ot_profile_date_idx
  on public.employee_overtime_assignments(profile_id, starts_at, ends_at);

alter table public.attendance_sessions
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists break_minutes integer not null default 0,
  add column if not exists worked_minutes integer,
  add column if not exists normal_minutes integer,
  add column if not exists overtime_minutes integer not null default 0,
  add column if not exists late_minutes integer not null default 0,
  add column if not exists early_leave_minutes integer not null default 0,
  add column if not exists calculation_status text not null default 'pending'
    check (calculation_status in ('pending','calculated','needs_review','excluded'));

create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  pay_date date not null,
  status text not null default 'draft'
    check (status in ('draft','calculating','review','approved','closed','paying','paid','cancelled')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(starts_on, ends_on),
  check (ends_on >= starts_on)
);

create table if not exists public.employee_payrolls (
  id uuid primary key default gen_random_uuid(),
  pay_period_id uuid not null references public.pay_periods(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  normal_minutes integer not null default 0,
  overtime_minutes integer not null default 0,
  base_pay numeric(14,2) not null default 0,
  overtime_pay numeric(14,2) not null default 0,
  additions numeric(14,2) not null default 0,
  deductions numeric(14,2) not null default 0,
  reimbursements numeric(14,2) not null default 0,
  net_pay numeric(14,2) not null default 0,
  status text not null default 'estimated'
    check (status in ('estimated','needs_review','approved','closed','pending_payment','paid','adjusted','void')),
  payment_reference text,
  paid_at timestamptz,
  transfer_document_id uuid references public.financial_transactions(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(pay_period_id, profile_id)
);

create table if not exists public.employee_payroll_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_id uuid not null references public.employee_payrolls(id) on delete cascade,
  line_type text not null check (
    line_type in ('base_pay','paid_leave','overtime','allowance','bonus','reimbursement','advance','deduction','unpaid_leave','adjustment')
  ),
  description text not null,
  quantity numeric(14,3),
  rate numeric(14,4),
  amount numeric(14,2) not null,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_id uuid not null unique references public.employee_payrolls(id) on delete cascade,
  document_number text not null unique,
  storage_path text,
  status text not null default 'draft'
    check (status in ('draft','approved','issued','delivered','viewed','superseded','void')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  issued_at timestamptz,
  delivered_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_document_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null check (
    document_type in ('payslip','income_certificate','employment_certificate','attendance_summary','overtime_summary','expense_summary','payment_evidence','other')
  ),
  pay_period_id uuid references public.pay_periods(id) on delete set null,
  request_channel text not null default 'web' check (request_channel in ('web','line_private','staff')),
  delivery_channel text not null default 'web' check (delivery_channel in ('web','line_private','physical')),
  reason text,
  status text not null default 'pending'
    check (status in ('draft','pending','needs_information','approved','rejected','generating','ready','delivered','received','expired','cancelled','failed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  output_storage_path text,
  access_expires_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_qualifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  qualification_type text not null check (qualification_type in ('skill','license','certification','education')),
  name text not null,
  level text,
  issuer text,
  issued_on date,
  expires_on date,
  document_id uuid references public.employee_identity_documents(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','verified','expired','rejected')),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_training_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  course_name text not null,
  provider text,
  starts_on date,
  completed_on date,
  expires_on date,
  result text,
  certificate_document_id uuid references public.employee_identity_documents(id) on delete set null,
  status text not null default 'assigned' check (status in ('assigned','in_progress','passed','failed','expired','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_asset_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  asset_type text not null,
  asset_code text,
  description text not null,
  issued_at timestamptz not null default now(),
  returned_at timestamptz,
  issue_condition text,
  return_condition text,
  status text not null default 'issued' check (status in ('reserved','issued','returned','lost','damaged','written_off')),
  issued_by uuid references public.profiles(id) on delete set null,
  received_back_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_lifecycle_cases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  case_type text not null check (case_type in ('onboarding','probation','transfer','offboarding')),
  effective_on date not null,
  status text not null default 'open' check (status in ('open','in_progress','blocked','completed','cancelled')),
  owner_id uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_lifecycle_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.employee_lifecycle_cases(id) on delete cascade,
  task_type text not null,
  title text not null,
  due_on date,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','waived','blocked')),
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_workforce_audit_logs (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  reason text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'employee-workforce-documents','employee-workforce-documents',false,15728640,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- RLS: employees see their own operational records; managers administer them.
alter table public.work_policies enable row level security;
alter table public.company_holidays enable row level security;
alter table public.employee_employment_records enable row level security;
alter table public.employee_line_accounts enable row level security;
alter table public.leave_types enable row level security;
alter table public.employee_leave_balances enable row level security;
alter table public.employee_leave_requests enable row level security;
alter table public.employee_overtime_assignments enable row level security;
alter table public.pay_periods enable row level security;
alter table public.employee_payrolls enable row level security;
alter table public.employee_payroll_lines enable row level security;
alter table public.employee_payslips enable row level security;
alter table public.employee_document_requests enable row level security;
alter table public.employee_qualifications enable row level security;
alter table public.employee_training_records enable row level security;
alter table public.employee_asset_assignments enable row level security;
alter table public.employee_lifecycle_cases enable row level security;
alter table public.employee_lifecycle_tasks enable row level security;
alter table public.employee_workforce_audit_logs enable row level security;

create policy "Authenticated read workforce policies" on public.work_policies
  for select to authenticated using (active or public.is_work_manager());
create policy "Managers manage workforce policies" on public.work_policies
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Authenticated read holidays" on public.company_holidays
  for select to authenticated using (true);
create policy "Managers manage holidays" on public.company_holidays
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own employment" on public.employee_employment_records
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage employment" on public.employee_employment_records
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own LINE link" on public.employee_line_accounts
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage employee LINE links" on public.employee_line_accounts
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Authenticated read leave types" on public.leave_types
  for select to authenticated using (active or public.is_work_manager());
create policy "Managers manage leave types" on public.leave_types
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own leave balance" on public.employee_leave_balances
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage leave balance" on public.employee_leave_balances
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own leave" on public.employee_leave_requests
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Employees request own leave" on public.employee_leave_requests
  for insert to authenticated with check (profile_id=auth.uid() and status in ('draft','pending','late_notice'));
create policy "Employees cancel own pending leave" on public.employee_leave_requests
  for update to authenticated using (profile_id=auth.uid() and status in ('draft','pending','late_notice'))
  with check (profile_id=auth.uid() and status in ('draft','pending','late_notice','cancelled'));
create policy "Managers review leave" on public.employee_leave_requests
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own OT" on public.employee_overtime_assignments
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Employees acknowledge own OT" on public.employee_overtime_assignments
  for update to authenticated using (profile_id=auth.uid() and status='assigned')
  with check (profile_id=auth.uid() and status='acknowledged');
create policy "Managers manage OT" on public.employee_overtime_assignments
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers manage pay periods" on public.pay_periods
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Authenticated read pay period dates" on public.pay_periods
  for select to authenticated using (true);
create policy "Employees read own payroll" on public.employee_payrolls
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage payroll" on public.employee_payrolls
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own payroll lines" on public.employee_payroll_lines
  for select to authenticated using (
    exists(select 1 from public.employee_payrolls p where p.id=payroll_id and (p.profile_id=auth.uid() or public.is_work_manager()))
  );
create policy "Managers manage payroll lines" on public.employee_payroll_lines
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own payslips" on public.employee_payslips
  for select to authenticated using (
    exists(select 1 from public.employee_payrolls p where p.id=payroll_id and (p.profile_id=auth.uid() or public.is_work_manager()))
  );
create policy "Managers manage payslips" on public.employee_payslips
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own document requests" on public.employee_document_requests
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Employees create own document requests" on public.employee_document_requests
  for insert to authenticated with check (profile_id=auth.uid() and status in ('draft','pending'));
create policy "Managers manage document requests" on public.employee_document_requests
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own qualifications" on public.employee_qualifications
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage qualifications" on public.employee_qualifications
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own training" on public.employee_training_records
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage training" on public.employee_training_records
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own assets" on public.employee_asset_assignments
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage employee assets" on public.employee_asset_assignments
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own lifecycle" on public.employee_lifecycle_cases
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());
create policy "Managers manage lifecycle" on public.employee_lifecycle_cases
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own lifecycle tasks" on public.employee_lifecycle_tasks
  for select to authenticated using (
    exists(select 1 from public.employee_lifecycle_cases c where c.id=case_id and (c.profile_id=auth.uid() or public.is_work_manager()))
  );
create policy "Managers manage lifecycle tasks" on public.employee_lifecycle_tasks
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Employees read own workforce audit" on public.employee_workforce_audit_logs
  for select to authenticated using (profile_id=auth.uid() or public.is_work_manager());

create policy "Employees upload own workforce documents" on storage.objects
  for insert to authenticated with check (
    bucket_id='employee-workforce-documents'
    and (storage.foldername(name))[1]=auth.uid()::text
  );
create policy "Employees read own workforce documents" on storage.objects
  for select to authenticated using (
    bucket_id='employee-workforce-documents'
    and ((storage.foldername(name))[1]=auth.uid()::text or public.is_work_manager())
  );
