-- Employee money ledger: a reversible holding layer between reviewed transfer slips
-- and final payroll. Source/OCR facts remain immutable and payroll is never posted here.

create or replace function public.normalize_employee_payment_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(
    regexp_replace(btrim(coalesce(value, '')), '^(นาย|นางสาว|นาง|คุณ|ช่าง|ด\.ช\.|ด\.ญ\.)[[:space:]]*', '', 'i'),
    '[[:space:].\\/_-]+', '', 'g'
  ));
$$;

create table if not exists public.employee_payment_name_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  alias_name text not null check (length(btrim(alias_name)) >= 2),
  normalized_alias text not null,
  reason text not null check (length(btrim(reason)) >= 3),
  event_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id, normalized_alias),
  unique(company_id, event_key)
);

create table if not exists public.employee_money_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_profile_id uuid not null references public.profiles(id) on delete restrict,
  financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  allocation_id uuid references public.transfer_slip_money_allocations(id) on delete restrict,
  daily_wage_confirmation_id uuid references public.daily_wage_transfer_confirmations(id) on delete restrict,
  source_flow_item_id uuid references public.document_flow_items(id) on delete restrict,
  source_key text not null,
  source_fingerprint text not null,
  source_name text not null,
  normalized_source_name text not null,
  account_scope text not null check (account_scope in ('advance','wage')),
  entry_type text not null check (entry_type in (
    'advance_issued','wage_paid','advance_recovered','cash_return',
    'adjustment_debit','adjustment_credit','reversal'
  )),
  amount numeric(14,2) not null check (amount > 0),
  effective_on date,
  evidence_date_status text not null check (evidence_date_status in ('verified','unverified')),
  match_method text not null check (match_method in ('exact_name','confirmed_alias','manual_adjustment')),
  entry_status text not null default 'matched_pending_review' check (entry_status in ('matched_pending_review','approved','rejected','reversed')),
  adjusts_entry_id uuid references public.employee_money_ledger_entries(id) on delete restrict,
  reason text,
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot) = 'object'),
  event_key text not null,
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_key),
  unique(company_id, event_key),
  check ((entry_type in ('adjustment_debit','adjustment_credit','reversal')) = (adjusts_entry_id is not null))
);

create index if not exists employee_money_ledger_employee_idx
  on public.employee_money_ledger_entries(company_id, employee_profile_id, entry_status, effective_on desc nulls last);
create index if not exists employee_money_ledger_transaction_idx
  on public.employee_money_ledger_entries(financial_transaction_id)
  where financial_transaction_id is not null;

create table if not exists public.employee_money_ledger_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entry_id uuid not null references public.employee_money_ledger_entries(id) on delete restrict,
  event_key text not null,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now(),
  unique(company_id, event_key)
);
create index if not exists employee_money_ledger_audit_entry_idx
  on public.employee_money_ledger_audit(entry_id, created_at desc);

create table if not exists public.employee_money_match_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  allocation_id uuid references public.transfer_slip_money_allocations(id) on delete restrict,
  source_key text not null,
  source_name text,
  normalized_source_name text,
  candidate_profile_ids uuid[] not null default '{}',
  match_status text not null check (match_status in ('matched_pending_review','unmatched','ambiguous','ignored_duplicate','invalid_source','failed')),
  reason text not null,
  ledger_entry_id uuid references public.employee_money_ledger_entries(id) on delete restrict,
  event_key text not null,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, source_key)
);
create index if not exists employee_money_match_queue_status_idx
  on public.employee_money_match_queue(company_id, match_status, updated_at desc);

alter table public.employee_payment_name_aliases enable row level security;
alter table public.employee_money_ledger_entries enable row level security;
alter table public.employee_money_ledger_audit enable row level security;
alter table public.employee_money_match_queue enable row level security;

revoke all on public.employee_payment_name_aliases, public.employee_money_ledger_entries, public.employee_money_ledger_audit, public.employee_money_match_queue from anon, authenticated;
grant select on public.employee_payment_name_aliases, public.employee_money_ledger_entries, public.employee_money_ledger_audit, public.employee_money_match_queue to authenticated;
revoke insert, update, delete on public.employee_payment_name_aliases, public.employee_money_ledger_entries, public.employee_money_ledger_audit, public.employee_money_match_queue from anon, authenticated;

drop policy if exists "Employee money aliases readable by authorised roles" on public.employee_payment_name_aliases;
create policy "Employee money aliases readable by authorised roles" on public.employee_payment_name_aliases
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or public.is_document_flow_department_member(company_id, 'hr')
  )
);

drop policy if exists "Employee money ledger readable by owner and authorised roles" on public.employee_money_ledger_entries;
create policy "Employee money ledger readable by owner and authorised roles" on public.employee_money_ledger_entries
for select to authenticated using (
  company_id = public.current_company_id() and (
    employee_profile_id = auth.uid() or public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or public.is_document_flow_department_member(company_id, 'hr')
  )
);

drop policy if exists "Employee money audit readable by owner and authorised roles" on public.employee_money_ledger_audit;
create policy "Employee money audit readable by owner and authorised roles" on public.employee_money_ledger_audit
for select to authenticated using (
  company_id = public.current_company_id() and exists (
    select 1 from public.employee_money_ledger_entries entry
    where entry.id = entry_id and (
      entry.employee_profile_id = auth.uid() or public.is_platform_admin() or public.is_company_manager(company_id)
      or public.is_document_flow_department_member(company_id, 'accounting')
      or public.is_document_flow_department_member(company_id, 'hr')
    )
  )
);

drop policy if exists "Employee money match queue readable by authorised roles" on public.employee_money_match_queue;
create policy "Employee money match queue readable by authorised roles" on public.employee_money_match_queue
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_platform_admin() or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or public.is_document_flow_department_member(company_id, 'hr')
  )
);

create or replace function public.project_employee_money_source(
  target_transaction_id uuid,
  target_allocation_id uuid,
  target_event_key text,
  target_actor_profile_id uuid default null
) returns public.employee_money_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.financial_transactions;
  allocation_row public.transfer_slip_money_allocations;
  source_item public.document_flow_items;
  source_key_value text;
  source_name_value text;
  normalized_name_value text;
  purpose_value text;
  amount_value numeric;
  source_fingerprint_value text;
  candidate_ids uuid[] := '{}';
  direct_ids uuid[] := '{}';
  candidate_count integer := 0;
  match_method_value text;
  entry_type_value text;
  account_scope_value text;
  effective_on_value date;
  date_status_value text := 'unverified';
  result public.employee_money_ledger_entries;
begin
  if nullif(btrim(target_event_key), '') is null then raise exception 'employee_money_event_key_required'; end if;
  select * into transaction_row from public.financial_transactions where id = target_transaction_id;
  if transaction_row.id is null or transaction_row.company_id is null then raise exception 'employee_money_transaction_not_found'; end if;

  source_key_value := case when target_allocation_id is null then 'transaction:' || transaction_row.id::text else 'allocation:' || target_allocation_id::text end;
  select * into source_item from public.document_flow_items where source_message_id = transaction_row.source_message_id order by created_at limit 1;

  if transaction_row.review_status in ('duplicate','dismissed') or transaction_row.duplicate_of is not null then
    insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name, normalized_source_name, match_status, reason, event_key)
    values(transaction_row.company_id, transaction_row.id, target_allocation_id, source_key_value, transaction_row.recipient_name,
      public.normalize_employee_payment_name(transaction_row.recipient_name), 'ignored_duplicate', 'สลิปถูกทำเครื่องหมายซ้ำหรือยกเลิก', target_event_key)
    on conflict(company_id, source_key) do update set match_status = excluded.match_status, reason = excluded.reason, event_key = excluded.event_key, updated_at = now();
    return null;
  end if;

  if target_allocation_id is not null then
    select * into allocation_row from public.transfer_slip_money_allocations where id = target_allocation_id and company_id = transaction_row.company_id;
    if allocation_row.id is null or allocation_row.status not in ('confirmed','routed','reconciled') then raise exception 'employee_money_allocation_not_confirmed'; end if;
    purpose_value := allocation_row.purpose_type;
    amount_value := allocation_row.allocation_amount;
    source_name_value := coalesce(nullif(btrim(allocation_row.payee_name), ''), transaction_row.recipient_name);
  else
    purpose_value := case transaction_row.expense_type when 'labor' then 'payroll' when 'advance' then 'advance_transfer' else 'unknown' end;
    amount_value := transaction_row.amount_total;
    source_name_value := transaction_row.recipient_name;
  end if;

  if purpose_value = 'payroll' then entry_type_value := 'wage_paid'; account_scope_value := 'wage';
  elsif purpose_value = 'advance_transfer' then entry_type_value := 'advance_issued'; account_scope_value := 'advance';
  else
    insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name, normalized_source_name, match_status, reason, event_key)
    values(transaction_row.company_id, transaction_row.id, target_allocation_id, source_key_value, source_name_value,
      public.normalize_employee_payment_name(source_name_value), 'invalid_source', 'รองรับเฉพาะค่าแรงหรือเงินเบิกล่วงหน้า', target_event_key)
    on conflict(company_id, source_key) do update set match_status = excluded.match_status, reason = excluded.reason, event_key = excluded.event_key, updated_at = now();
    return null;
  end if;
  if amount_value is null or amount_value <= 0 or nullif(btrim(source_name_value), '') is null then
    insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name, normalized_source_name, match_status, reason, event_key)
    values(transaction_row.company_id, transaction_row.id, target_allocation_id, source_key_value, source_name_value,
      public.normalize_employee_payment_name(source_name_value), 'invalid_source', 'ชื่อผู้รับหรือจำนวนเงินไม่ครบ', target_event_key)
    on conflict(company_id, source_key) do update set match_status = excluded.match_status, reason = excluded.reason, event_key = excluded.event_key, updated_at = now();
    return null;
  end if;

  normalized_name_value := public.normalize_employee_payment_name(source_name_value);
  select coalesce(array_agg(distinct employment.profile_id), '{}') into direct_ids
  from public.employee_employment_records employment
  join public.profiles profile on profile.id = employment.profile_id
  where employment.company_id = transaction_row.company_id
    and employment.employment_type = 'daily'
    and employment.employment_status in ('active','probation','notice')
    and public.normalize_employee_payment_name(profile.full_name) = normalized_name_value;

  select coalesce(array_agg(distinct matched.profile_id), '{}') into candidate_ids
  from (
    select unnest(direct_ids) profile_id
    union
    select alias.profile_id
    from public.employee_payment_name_aliases alias
    join public.employee_employment_records employment on employment.profile_id = alias.profile_id and employment.company_id = alias.company_id
    where alias.company_id = transaction_row.company_id
      and alias.normalized_alias = normalized_name_value
      and employment.employment_type = 'daily'
      and employment.employment_status in ('active','probation','notice')
  ) matched;
  candidate_count := cardinality(candidate_ids);

  if candidate_count <> 1 then
    insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name, normalized_source_name, candidate_profile_ids, match_status, reason, event_key)
    values(transaction_row.company_id, transaction_row.id, target_allocation_id, source_key_value, source_name_value, normalized_name_value,
      candidate_ids, case when candidate_count = 0 then 'unmatched' else 'ambiguous' end,
      case when candidate_count = 0 then 'ไม่พบชื่อช่างรายวันที่ตรงกัน' else 'พบชื่อช่างมากกว่าหนึ่งคน' end, target_event_key)
    on conflict(company_id, source_key) do update set candidate_profile_ids = excluded.candidate_profile_ids,
      match_status = excluded.match_status, reason = excluded.reason, event_key = excluded.event_key, updated_at = now();
    return null;
  end if;

  match_method_value := case when candidate_ids[1] = any(direct_ids) then 'exact_name' else 'confirmed_alias' end;
  if transaction_row.transfer_at is not null
    and extract(year from transaction_row.transfer_at) between 2000 and extract(year from current_date) + 1 then
    effective_on_value := (transaction_row.transfer_at at time zone 'Asia/Bangkok')::date;
    date_status_value := 'verified';
  end if;
  source_fingerprint_value := coalesce(nullif(transaction_row.image_sha256, ''), nullif(transaction_row.dedupe_key, ''),
    nullif(transaction_row.bank_reference, ''), transaction_row.id::text);

  insert into public.employee_money_ledger_entries(
    company_id, employee_profile_id, financial_transaction_id, allocation_id, daily_wage_confirmation_id, source_flow_item_id,
    source_key, source_fingerprint, source_name, normalized_source_name, account_scope, entry_type,
    amount, effective_on, evidence_date_status, match_method, entry_status, reason, source_snapshot,
    event_key, created_by
  ) values (
    transaction_row.company_id, candidate_ids[1], transaction_row.id, target_allocation_id,
    (select confirmation.id from public.daily_wage_transfer_confirmations confirmation where confirmation.financial_transaction_id = transaction_row.id), source_item.id,
    source_key_value, source_fingerprint_value, source_name_value, normalized_name_value, account_scope_value, entry_type_value,
    amount_value, effective_on_value, date_status_value, match_method_value, 'matched_pending_review',
    'จับคู่ชื่อช่างรายวันและบันทึกเข้าบัญชีพัก รอผู้มีสิทธิ์ตรวจ',
    jsonb_build_object('sender_name', transaction_row.sender_name, 'recipient_name', transaction_row.recipient_name,
      'amount_total', transaction_row.amount_total, 'transfer_at', transaction_row.transfer_at,
      'bank_reference', transaction_row.bank_reference, 'review_status', transaction_row.review_status,
      'allocation_id', target_allocation_id, 'purpose', purpose_value),
    target_event_key, target_actor_profile_id
  ) on conflict(company_id, source_key) do nothing;
  select * into result from public.employee_money_ledger_entries where company_id = transaction_row.company_id and source_key = source_key_value;

  insert into public.employee_money_ledger_audit(company_id, entry_id, event_key, action, actor_profile_id, after_data, reason)
  values(result.company_id, result.id, target_event_key || ':audit', 'matched_to_employee_holding_account', target_actor_profile_id,
    to_jsonb(result), 'บันทึกบัญชีพักเท่านั้น ยังไม่สร้าง Payroll Line และยังไม่หักค่าแรง')
  on conflict(company_id, event_key) do nothing;

  insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name,
    normalized_source_name, candidate_profile_ids, match_status, reason, ledger_entry_id, event_key)
  values(result.company_id, transaction_row.id, target_allocation_id, source_key_value, source_name_value, normalized_name_value,
    candidate_ids, 'matched_pending_review', 'จับคู่แล้วและรอตรวจบัญชีพัก', result.id, target_event_key)
  on conflict(company_id, source_key) do update set candidate_profile_ids = excluded.candidate_profile_ids,
    match_status = excluded.match_status, reason = excluded.reason, ledger_entry_id = excluded.ledger_entry_id,
    event_key = excluded.event_key, updated_at = now();

  if source_item.id is not null then
    insert into public.document_flow_events(item_id, company_id, event_key, event_type, from_flow, to_flow, from_state, to_state,
      from_room, to_room, note, payload, actor_id)
    values(source_item.id, result.company_id, target_event_key || ':flow', 'employee_money_holding_account_matched',
      source_item.current_flow, source_item.current_flow, source_item.state, source_item.state, source_item.current_room,
      'employee_money_review_queue', 'จับคู่ชื่อช่างและบันทึกบัญชีพัก โดยยังไม่กระทบ Payroll',
      jsonb_build_object('entry_id', result.id, 'employee_profile_id', result.employee_profile_id,
        'entry_type', result.entry_type, 'amount', result.amount, 'entry_status', result.entry_status), target_actor_profile_id)
    on conflict(event_key) do nothing;
  end if;
  return result;
end;
$$;

revoke all on function public.project_employee_money_source(uuid,uuid,text,uuid) from public, anon, authenticated;

create or replace function public.confirm_employee_payment_name_alias(
  target_profile_id uuid,
  target_alias_name text,
  target_event_key text,
  target_reason text
) returns public.employee_payment_name_aliases
language plpgsql
security definer
set search_path = ''
as $$
declare company_id_value uuid; normalized_value text; existing_row public.employee_payment_name_aliases; result public.employee_payment_name_aliases;
begin
  select employment.company_id into company_id_value
  from public.employee_employment_records employment
  where employment.profile_id = target_profile_id and employment.employment_type = 'daily'
    and employment.employment_status in ('active','probation','notice')
  order by employment.updated_at desc limit 1;
  if company_id_value is null or not public.is_company_manager(company_id_value) then raise exception 'employee_payment_alias_profile_not_found_or_denied'; end if;
  normalized_value := public.normalize_employee_payment_name(target_alias_name);
  if length(normalized_value) < 2 or length(btrim(coalesce(target_reason, ''))) < 3 or nullif(btrim(target_event_key), '') is null then raise exception 'employee_payment_alias_input_invalid'; end if;
  select * into existing_row from public.employee_payment_name_aliases where company_id = company_id_value and normalized_alias = normalized_value;
  if existing_row.id is not null and existing_row.profile_id <> target_profile_id then raise exception 'employee_payment_alias_already_assigned'; end if;
  insert into public.employee_payment_name_aliases(company_id, profile_id, alias_name, normalized_alias, reason, event_key, created_by)
  values(company_id_value, target_profile_id, btrim(target_alias_name), normalized_value, btrim(target_reason), target_event_key, auth.uid())
  on conflict(company_id, normalized_alias) do update set alias_name = public.employee_payment_name_aliases.alias_name
  returning * into result;
  return result;
end;
$$;

create or replace function public.project_employee_money_allocation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare transaction_id_value uuid;
begin
  if new.status in ('confirmed','routed','reconciled') and new.purpose_type in ('payroll','advance_transfer') then
    select lineage.transaction_id into transaction_id_value from public.transfer_slip_money_lineages lineage where lineage.id = new.lineage_id;
    if transaction_id_value is not null then
      perform public.project_employee_money_source(transaction_id_value, new.id, 'employee-money:allocation:' || new.id::text, auth.uid());
    end if;
  end if;
  return new;
exception when others then
  if transaction_id_value is null then
    select lineage.transaction_id into transaction_id_value from public.transfer_slip_money_lineages lineage where lineage.id = new.lineage_id;
  end if;
  if transaction_id_value is not null then
    insert into public.employee_money_match_queue(company_id, financial_transaction_id, allocation_id, source_key, source_name,
      normalized_source_name, match_status, reason, event_key, retry_count, last_error)
    select transaction.company_id, transaction.id, new.id, 'allocation:' || new.id::text,
      coalesce(nullif(btrim(new.payee_name), ''), transaction.recipient_name),
      public.normalize_employee_payment_name(coalesce(nullif(btrim(new.payee_name), ''), transaction.recipient_name)),
      'failed', 'สร้างบัญชีพักไม่สำเร็จและรอ Retry', 'employee-money:allocation:' || new.id::text,
      1, left(sqlerrm, 1000)
    from public.financial_transactions transaction where transaction.id = transaction_id_value
    on conflict(company_id, source_key) do update set match_status = 'failed', reason = excluded.reason,
      retry_count = public.employee_money_match_queue.retry_count + 1, last_error = excluded.last_error, updated_at = now();
  end if;
  raise warning 'employee money projection deferred for allocation %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists project_employee_money_allocation_after_confirm on public.transfer_slip_money_allocations;
create trigger project_employee_money_allocation_after_confirm
after insert or update of status, purpose_type, payee_name, allocation_amount on public.transfer_slip_money_allocations
for each row execute function public.project_employee_money_allocation_trigger();

create or replace function public.queue_legacy_employee_money_match(target_transaction_id uuid, target_event_key text)
returns public.employee_money_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare transaction_row public.financial_transactions;
begin
  select * into transaction_row from public.financial_transactions where id = target_transaction_id;
  if transaction_row.id is null or not public.is_company_manager(transaction_row.company_id) then raise exception 'employee_money_source_not_found_or_denied'; end if;
  if transaction_row.expense_type = 'labor' and transaction_row.review_status <> 'confirmed' then raise exception 'legacy_wage_payment_requires_accounting_confirmation'; end if;
  if transaction_row.expense_type not in ('labor','advance') then raise exception 'legacy_employee_money_type_requires_review'; end if;
  return public.project_employee_money_source(transaction_row.id, null, target_event_key, auth.uid());
end;
$$;

create or replace function public.review_employee_money_ledger_entry(
  target_entry_id uuid,
  target_event_key text,
  target_action text,
  target_expected_version integer,
  target_reason text default null
) returns public.employee_money_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare before_row public.employee_money_ledger_entries; result public.employee_money_ledger_entries;
begin
  select * into before_row from public.employee_money_ledger_entries where id = target_entry_id for update;
  if before_row.id is null or not public.is_company_manager(before_row.company_id) then raise exception 'employee_money_entry_not_found_or_denied'; end if;
  if before_row.version <> target_expected_version then raise exception 'employee_money_version_conflict'; end if;
  if exists(select 1 from public.employee_money_ledger_audit where company_id = before_row.company_id and event_key = target_event_key) then return before_row; end if;
  if target_action = 'approve' and before_row.entry_status = 'matched_pending_review' then
    update public.employee_money_ledger_entries set entry_status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
      reason = coalesce(nullif(btrim(target_reason), ''), reason), version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'reject' and before_row.entry_status = 'matched_pending_review' then
    if length(btrim(coalesce(target_reason, ''))) < 3 then raise exception 'employee_money_reject_reason_required'; end if;
    update public.employee_money_ledger_entries set entry_status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      reason = btrim(target_reason), version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  elsif target_action = 'reverse' and before_row.entry_status = 'approved' then
    if length(btrim(coalesce(target_reason, ''))) < 3 then raise exception 'employee_money_reverse_reason_required'; end if;
    update public.employee_money_ledger_entries set entry_status = 'reversed', reviewed_by = auth.uid(), reviewed_at = now(),
      reason = btrim(target_reason), version = version + 1, updated_at = now()
    where id = before_row.id returning * into result;
  else raise exception 'employee_money_transition_invalid';
  end if;
  insert into public.employee_money_ledger_audit(company_id, entry_id, event_key, action, actor_profile_id, before_data, after_data, reason)
  values(before_row.company_id, before_row.id, target_event_key, target_action, auth.uid(), to_jsonb(before_row), to_jsonb(result), nullif(btrim(target_reason), ''));
  return result;
end;
$$;

create or replace function public.create_employee_money_adjustment(
  target_entry_id uuid,
  target_event_key text,
  target_adjustment_type text,
  target_account_scope text,
  target_amount numeric,
  target_effective_on date,
  target_reason text
) returns public.employee_money_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare source_row public.employee_money_ledger_entries; result public.employee_money_ledger_entries;
begin
  select * into source_row from public.employee_money_ledger_entries where id = target_entry_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'employee_money_entry_not_found_or_denied'; end if;
  if target_adjustment_type not in ('adjustment_debit','adjustment_credit','reversal')
    or target_account_scope not in ('advance','wage') or target_amount <= 0 then raise exception 'employee_money_adjustment_invalid'; end if;
  if length(btrim(coalesce(target_reason, ''))) < 3 then raise exception 'employee_money_adjustment_reason_required'; end if;
  select * into result from public.employee_money_ledger_entries where company_id = source_row.company_id and event_key = target_event_key;
  if result.id is not null then return result; end if;
  insert into public.employee_money_ledger_entries(company_id, employee_profile_id, financial_transaction_id, allocation_id, daily_wage_confirmation_id,
    source_flow_item_id, source_key, source_fingerprint, source_name, normalized_source_name, account_scope, entry_type,
    amount, effective_on, evidence_date_status, match_method, entry_status, adjusts_entry_id, reason, source_snapshot,
    event_key, created_by)
  values(source_row.company_id, source_row.employee_profile_id, source_row.financial_transaction_id, source_row.allocation_id, source_row.daily_wage_confirmation_id,
    source_row.source_flow_item_id, 'adjustment:' || target_event_key, source_row.source_fingerprint, source_row.source_name,
    source_row.normalized_source_name, target_account_scope, target_adjustment_type, target_amount, target_effective_on,
    case when target_effective_on is null then 'unverified' else 'verified' end, 'manual_adjustment',
    'matched_pending_review', source_row.id, btrim(target_reason),
    jsonb_build_object('adjusts_entry_id', source_row.id, 'original_entry_status', source_row.entry_status), target_event_key, auth.uid())
  returning * into result;
  insert into public.employee_money_ledger_audit(company_id, entry_id, event_key, action, actor_profile_id, after_data, reason)
  values(result.company_id, result.id, target_event_key || ':audit', 'adjustment_created', auth.uid(), to_jsonb(result), btrim(target_reason));
  return result;
end;
$$;

revoke all on function public.confirm_employee_payment_name_alias(uuid,text,text,text), public.queue_legacy_employee_money_match(uuid,text), public.review_employee_money_ledger_entry(uuid,text,text,integer,text), public.create_employee_money_adjustment(uuid,text,text,text,numeric,date,text) from public, anon;
grant execute on function public.confirm_employee_payment_name_alias(uuid,text,text,text), public.queue_legacy_employee_money_match(uuid,text), public.review_employee_money_ledger_entry(uuid,text,text,integer,text), public.create_employee_money_adjustment(uuid,text,text,text,numeric,date,text) to authenticated;

create or replace view public.employee_money_balance_summary
with (security_invoker = true)
as
select entry.company_id,
  entry.employee_profile_id,
  profile.full_name as employee_name,
  employment.employee_code,
  count(*) as entry_count,
  count(*) filter (where entry.entry_status = 'matched_pending_review') as pending_count,
  coalesce(sum(case
    when entry.entry_status = 'approved' and entry.account_scope = 'advance' and entry.entry_type in ('advance_issued','adjustment_debit') then entry.amount
    when entry.entry_status = 'approved' and entry.account_scope = 'advance' and entry.entry_type in ('advance_recovered','cash_return','adjustment_credit','reversal') then -entry.amount
    else 0 end), 0)::numeric(14,2) as approved_advance_balance,
  coalesce(sum(case when entry.entry_status = 'matched_pending_review' and entry.account_scope = 'advance' then entry.amount else 0 end), 0)::numeric(14,2) as pending_advance_amount,
  coalesce(sum(case
    when entry.entry_status = 'approved' and entry.account_scope = 'wage' and entry.entry_type in ('wage_paid','adjustment_debit') then entry.amount
    when entry.entry_status = 'approved' and entry.account_scope = 'wage' and entry.entry_type in ('adjustment_credit','reversal') then -entry.amount
    else 0 end), 0)::numeric(14,2) as approved_wage_paid,
  coalesce(sum(case when entry.entry_status = 'matched_pending_review' and entry.account_scope = 'wage' then entry.amount else 0 end), 0)::numeric(14,2) as pending_wage_paid,
  max(entry.updated_at) as updated_at
from public.employee_money_ledger_entries entry
join public.profiles profile on profile.id = entry.employee_profile_id
left join public.employee_employment_records employment on employment.profile_id = entry.employee_profile_id and employment.company_id = entry.company_id
where entry.entry_status not in ('rejected','reversed')
group by entry.company_id, entry.employee_profile_id, profile.full_name, employment.employee_code;

create or replace view public.employee_money_legacy_candidates
with (security_invoker = true)
as
select transaction.id as financial_transaction_id, transaction.company_id, employment.profile_id as employee_profile_id,
  profile.full_name as employee_name, transaction.sender_name, transaction.recipient_name, transaction.amount_total,
  transaction.transfer_at, transaction.expense_type, transaction.review_status, transaction.bank_reference,
  case transaction.expense_type when 'advance' then 'advance_issued' when 'labor' then 'wage_paid' else null end as proposed_entry_type,
  case when transaction.transfer_at is not null and extract(year from transaction.transfer_at) between 2000 and extract(year from current_date) + 1 then 'verified' else 'unverified' end as evidence_date_status
from public.financial_transactions transaction
join public.employee_employment_records employment on employment.company_id = transaction.company_id
  and employment.employment_type = 'daily' and employment.employment_status in ('active','probation','notice')
join public.profiles profile on profile.id = employment.profile_id
where transaction.expense_type in ('advance','labor')
  and transaction.review_status not in ('duplicate','dismissed') and transaction.duplicate_of is null
  and public.normalize_employee_payment_name(transaction.recipient_name) = public.normalize_employee_payment_name(profile.full_name)
  and not exists(select 1 from public.employee_money_ledger_entries entry where entry.company_id = transaction.company_id and entry.source_key = 'transaction:' || transaction.id::text);

grant select on public.employee_money_balance_summary, public.employee_money_legacy_candidates to authenticated;

comment on table public.employee_money_ledger_entries is 'Reversible employee holding ledger. It never posts payroll or rewrites transfer-slip evidence.';
comment on table public.employee_money_ledger_audit is 'Append-only employee money review and adjustment history.';
comment on view public.employee_money_legacy_candidates is 'Exact-name historical candidates only. Managers explicitly queue them; no automatic payroll posting.';

notify pgrst, 'reload schema';
