-- Central advance registry.  A source slip remains canonical; this module only
-- records the accountable advance and its settlement lines.
create table if not exists public.employee_advance_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  advance_number text not null,
  financial_transaction_id uuid not null unique references public.financial_transactions(id) on delete restrict,
  source_flow_item_id uuid not null unique references public.document_flow_items(id) on delete restrict,
  holder_profile_id uuid references public.profiles(id) on delete restrict,
  holder_person_id uuid references public.employee_people(id) on delete restrict,
  amount_received numeric(14,2) not null check(amount_received > 0),
  received_at timestamptz,
  bank_reference text,
  project_id uuid references public.projects(id) on delete set null,
  work_package_id uuid references public.project_work_packages(id) on delete set null,
  status text not null default 'draft' check(status in ('draft','collecting_evidence','submitted','under_review','approved','settlement_required','closed','returned','cancelled')),
  purpose_note text,
  version integer not null default 1 check(version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(num_nonnulls(holder_profile_id, holder_person_id) = 1),
  unique(company_id, advance_number)
);
create index if not exists employee_advance_cases_company_status_idx on public.employee_advance_cases(company_id,status,updated_at desc);

create table if not exists public.employee_advance_settlement_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.employee_advance_cases(id) on delete cascade,
  line_no integer not null,
  expense_type text not null check(expense_type in ('daily_wage','materials','travel','other','cash_return','payroll_offset')),
  amount numeric(14,2) not null check(amount > 0),
  expense_date date not null default current_date,
  payee_name text,
  daily_employee_profile_id uuid references public.profiles(id) on delete set null,
  daily_employee_person_id uuid references public.employee_people(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  work_package_id uuid references public.project_work_packages(id) on delete set null,
  evidence_flow_item_id uuid references public.document_flow_items(id) on delete set null,
  evidence_reference text,
  description text not null,
  approval_status text not null default 'draft' check(approval_status in ('draft','submitted','approved','returned','rejected')),
  review_note text,
  version integer not null default 1 check(version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(expense_type <> 'daily_wage' or num_nonnulls(daily_employee_profile_id,daily_employee_person_id) = 1),
  unique(case_id,line_no)
);
create index if not exists employee_advance_settlement_case_idx on public.employee_advance_settlement_items(case_id,approval_status,line_no);

create table if not exists public.employee_advance_audit (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.employee_advance_cases(id) on delete cascade,
  item_id uuid references public.employee_advance_settlement_items(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_key text not null unique,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists employee_advance_audit_case_idx on public.employee_advance_audit(case_id,created_at desc);

alter table public.employee_advance_cases enable row level security;
alter table public.employee_advance_settlement_items enable row level security;
alter table public.employee_advance_audit enable row level security;
create policy "Company managers read employee advance cases" on public.employee_advance_cases for select to authenticated using(public.is_company_manager(company_id));
create policy "Company managers read employee advance settlement items" on public.employee_advance_settlement_items for select to authenticated using(exists(select 1 from public.employee_advance_cases c where c.id=case_id and public.is_company_manager(c.company_id)));
create policy "Company managers read employee advance audit" on public.employee_advance_audit for select to authenticated using(public.is_company_manager(company_id));
revoke insert,update,delete on public.employee_advance_cases,public.employee_advance_settlement_items,public.employee_advance_audit from anon,authenticated;

create or replace function public.create_employee_advance_from_transaction(
  target_transaction_id uuid,
  target_event_key text,
  target_purpose_note text default null
) returns public.employee_advance_cases
language plpgsql security definer set search_path=public as $$
declare
  transaction_row public.financial_transactions;
  source_item public.document_flow_items;
  holder_profile uuid;
  holder_person uuid;
  result public.employee_advance_cases;
begin
  select * into transaction_row from public.financial_transactions where id=target_transaction_id for update;
  if transaction_row.id is null or transaction_row.amount_total is null then raise exception 'advance_source_transaction_not_found_or_amount_missing'; end if;
  select * into source_item from public.document_flow_items where source_message_id=transaction_row.source_message_id for update;
  if source_item.id is null or not public.is_company_manager(source_item.company_id) then raise exception 'advance_permission_or_source_flow_denied'; end if;
  if transaction_row.review_status in ('duplicate','dismissed') then raise exception 'advance_source_transaction_not_usable'; end if;

  select employment.profile_id into holder_profile
  from public.employee_employment_records employment join public.profiles profile on profile.id=employment.profile_id
  where employment.company_id=source_item.company_id and employment.employment_type='monthly'
    and employment.employment_status in ('active','probation','notice')
    and nullif(btrim(transaction_row.recipient_name),'') is not null
    and lower(regexp_replace(btrim(profile.full_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g'))
  limit 1;
  if holder_profile is null then
    select person.id into holder_person from public.employee_people person
    where person.company_id=source_item.company_id and person.employment_type='monthly' and person.employee_status='active'
      and nullif(btrim(transaction_row.recipient_name),'') is not null
      and lower(regexp_replace(btrim(person.full_name),'\\s+','','g'))=lower(regexp_replace(btrim(transaction_row.recipient_name),'\\s+','','g'))
    limit 1;
  end if;
  if holder_profile is null and holder_person is null then raise exception 'advance_holder_not_matching_active_monthly_employee'; end if;

  insert into public.employee_advance_cases(company_id,advance_number,financial_transaction_id,source_flow_item_id,holder_profile_id,holder_person_id,amount_received,received_at,bank_reference,project_id,purpose_note,created_by)
  values(source_item.company_id,'ADV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMM')||'-'||upper(left(replace(source_item.id::text,'-',''),6)),transaction_row.id,source_item.id,holder_profile,holder_person,transaction_row.amount_total,transaction_row.transfer_at,transaction_row.bank_reference,transaction_row.project_id,nullif(btrim(target_purpose_note),''),auth.uid())
  on conflict(financial_transaction_id) do update set updated_at=public.employee_advance_cases.updated_at
  returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
  values(result.id,result.company_id,target_event_key,'create_from_transfer',auth.uid(),jsonb_build_object('source_flow_item_id',result.source_flow_item_id,'amount_received',result.amount_received),'สร้างรายการเงินทดรองจากสลิปต้นทาง') on conflict(event_key) do nothing;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(source_item.id,source_item.company_id,'advance-case:'||result.id::text,'employee_advance_case_created',source_item.current_flow,source_item.current_flow,source_item.state,source_item.state,source_item.current_room,source_item.current_room,'สร้างรายการเงินทดรองจากสลิป โดยคงเส้นทางเอกสารเดิม',jsonb_build_object('advance_case_id',result.id,'advance_number',result.advance_number),auth.uid()) on conflict(event_key) do nothing;
  return result;
end;
$$;

create or replace function public.add_employee_advance_settlement_item(
  target_case_id uuid,target_event_key text,target_expense_type text,target_amount numeric,target_expense_date date,target_payee_name text,target_project_id uuid,target_work_package_id uuid,target_evidence_flow_item_id uuid,target_evidence_reference text,target_description text
) returns public.employee_advance_settlement_items
language plpgsql security definer set search_path=public as $$
declare case_row public.employee_advance_cases; result public.employee_advance_settlement_items;
begin
  select * into case_row from public.employee_advance_cases where id=target_case_id for update;
  if case_row.id is null or not public.is_company_manager(case_row.company_id) then raise exception 'advance_case_not_found_or_denied'; end if;
  if case_row.status in ('closed','cancelled') then raise exception 'advance_case_is_closed'; end if;
  if target_expense_type not in ('daily_wage','materials','travel','other','cash_return','payroll_offset') or target_amount<=0 or length(btrim(coalesce(target_description,'')))<3 then raise exception 'advance_settlement_item_invalid'; end if;
  insert into public.employee_advance_settlement_items(case_id,line_no,expense_type,amount,expense_date,payee_name,project_id,work_package_id,evidence_flow_item_id,evidence_reference,description,created_by)
  values(case_row.id,(select coalesce(max(line_no),0)+1 from public.employee_advance_settlement_items where case_id=case_row.id),target_expense_type,target_amount,coalesce(target_expense_date,current_date),nullif(btrim(target_payee_name),''),target_project_id,target_work_package_id,target_evidence_flow_item_id,nullif(btrim(target_evidence_reference),''),btrim(target_description),auth.uid()) returning * into result;
  update public.employee_advance_cases set status='collecting_evidence',version=version+1,updated_at=now() where id=case_row.id;
  insert into public.employee_advance_audit(case_id,item_id,company_id,event_key,action,actor_profile_id,after_data) values(case_row.id,result.id,case_row.company_id,target_event_key,'add_settlement_item',auth.uid(),to_jsonb(result)) on conflict(event_key) do nothing;
  return result;
end;
$$;

create or replace function public.transition_employee_advance_case(target_case_id uuid,target_event_key text,target_action text,target_expected_version integer,target_reason text default null)
returns public.employee_advance_cases language plpgsql security definer set search_path=public as $$
declare before_row public.employee_advance_cases; result public.employee_advance_cases; approved_expenses numeric:=0; cash_return numeric:=0; payroll_offset numeric:=0; pending_count integer:=0;
begin
  select * into before_row from public.employee_advance_cases where id=target_case_id for update;
  if before_row.id is null or not public.is_company_manager(before_row.company_id) then raise exception 'advance_case_not_found_or_denied'; end if;
  if before_row.version<>target_expected_version then raise exception 'advance_version_conflict'; end if;
  if target_action='submit' then update public.employee_advance_settlement_items set approval_status='submitted',updated_at=now() where case_id=before_row.id and approval_status='draft'; update public.employee_advance_cases set status='submitted',version=version+1,updated_at=now() where id=before_row.id returning * into result;
  elsif target_action='approve' then update public.employee_advance_settlement_items set approval_status='approved',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where case_id=before_row.id and approval_status='submitted'; update public.employee_advance_cases set status='approved',version=version+1,updated_at=now() where id=before_row.id returning * into result;
  elsif target_action='return' then update public.employee_advance_settlement_items set approval_status='returned',reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(target_reason),''),updated_at=now() where case_id=before_row.id and approval_status='submitted'; update public.employee_advance_cases set status='returned',version=version+1,updated_at=now() where id=before_row.id returning * into result;
  elsif target_action='close' then
    select coalesce(sum(amount) filter(where approval_status='approved' and expense_type not in ('cash_return','payroll_offset')),0),coalesce(sum(amount) filter(where approval_status='approved' and expense_type='cash_return'),0),coalesce(sum(amount) filter(where approval_status='approved' and expense_type='payroll_offset'),0),count(*) filter(where approval_status in ('draft','submitted','returned')) into approved_expenses,cash_return,payroll_offset,pending_count from public.employee_advance_settlement_items where case_id=before_row.id;
    if pending_count>0 or round(before_row.amount_received-approved_expenses-cash_return-payroll_offset,2)<>0 then raise exception 'advance_cannot_close_outstanding_or_pending'; end if;
    update public.employee_advance_cases set status='closed',version=version+1,updated_at=now() where id=before_row.id returning * into result;
  else raise exception 'advance_transition_invalid'; end if;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,before_data,after_data,reason) values(before_row.id,before_row.company_id,target_event_key,target_action,auth.uid(),to_jsonb(before_row),to_jsonb(result),nullif(btrim(target_reason),'')) on conflict(event_key) do nothing;
  return result;
end;
$$;

revoke all on function public.create_employee_advance_from_transaction(uuid,text,text), public.add_employee_advance_settlement_item(uuid,text,text,numeric,date,text,uuid,uuid,uuid,text,text), public.transition_employee_advance_case(uuid,text,text,integer,text) from public,anon;
grant execute on function public.create_employee_advance_from_transaction(uuid,text,text), public.add_employee_advance_settlement_item(uuid,text,text,numeric,date,text,uuid,uuid,uuid,text,text), public.transition_employee_advance_case(uuid,text,text,integer,text) to authenticated;
notify pgrst,'reload schema';
