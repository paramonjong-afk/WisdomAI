-- Replay bootstrap for the Production-recorded version; the future correction remains separately versioned.
create table if not exists public.employee_money_pay_period_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ledger_entry_id uuid not null unique references public.employee_money_ledger_entries(id) on delete restrict,
  pay_period_id uuid not null references public.pay_periods(id) on delete restrict,
  assignment_method text not null check (assignment_method in ('transfer_date_auto','admin_selected')),
  reason text not null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_money_pay_period_assignments_company_period_idx
  on public.employee_money_pay_period_assignments(company_id, pay_period_id, updated_at desc);

alter table public.employee_money_pay_period_assignments enable row level security;
revoke all on public.employee_money_pay_period_assignments from public, anon, authenticated;
grant select on public.employee_money_pay_period_assignments to authenticated;

drop policy if exists "Authorised teams read employee money pay period assignments"
  on public.employee_money_pay_period_assignments;
create policy "Authorised teams read employee money pay period assignments"
on public.employee_money_pay_period_assignments
for select to authenticated
using (
  company_id = public.current_company_id() and (
    public.is_platform_admin()
    or public.is_company_manager(company_id)
    or public.is_document_flow_department_member(company_id, 'accounting')
    or public.is_document_flow_department_member(company_id, 'hr')
  )
);

create or replace function public.auto_assign_employee_money_pay_period(
  target_entry_id uuid,
  target_event_key text
) returns public.employee_money_pay_period_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.employee_money_ledger_entries;
  period_row public.pay_periods;
  period_count integer;
  result public.employee_money_pay_period_assignments;
begin
  if nullif(btrim(target_event_key), '') is null then
    raise exception 'employee_money_pay_period_event_key_required';
  end if;

  select * into entry_row
  from public.employee_money_ledger_entries
  where id = target_entry_id
  for update;

  if entry_row.id is null
    or entry_row.entry_type <> 'wage_paid'
    or entry_row.entry_status in ('rejected', 'reversed')
    or entry_row.effective_on is null
    or entry_row.evidence_date_status <> 'verified' then
    return null;
  end if;

  select count(*) into period_count
  from public.pay_periods period
  where period.company_id = entry_row.company_id
    and entry_row.effective_on between period.starts_on and period.ends_on
    and period.status not in ('closed', 'paying', 'paid', 'cancelled');

  if period_count <> 1 then return null; end if;
  select * into period_row
  from public.pay_periods period
  where period.company_id = entry_row.company_id
    and entry_row.effective_on between period.starts_on and period.ends_on
    and period.status not in ('closed', 'paying', 'paid', 'cancelled');

  select * into result
  from public.employee_money_pay_period_assignments assignment
  where assignment.ledger_entry_id = entry_row.id;
  if result.id is not null then return result; end if;

  insert into public.employee_money_pay_period_assignments(
    company_id, ledger_entry_id, pay_period_id, assignment_method, reason, assigned_by
  ) values (
    entry_row.company_id, entry_row.id, period_row.id, 'transfer_date_auto',
    'ผูกรอบอัตโนมัติจากวันที่โอนที่ยืนยันแล้วและพบรอบที่ตรงเพียงรอบเดียว', null
  ) returning * into result;

  insert into public.employee_money_ledger_audit(
    company_id, entry_id, event_key, action, actor_profile_id, after_data, reason
  ) values (
    entry_row.company_id, entry_row.id, target_event_key, 'pay_period_auto_assigned', null,
    jsonb_build_object('assignment_id', result.id, 'pay_period_id', result.pay_period_id,
      'assignment_method', result.assignment_method, 'effective_on', entry_row.effective_on),
    result.reason
  ) on conflict(company_id, event_key) do nothing;

  return result;
end;
$$;

revoke all on function public.auto_assign_employee_money_pay_period(uuid, text)
  from public, anon, authenticated;

create or replace function public.assign_employee_money_pay_period(
  target_entry_id uuid,
  target_pay_period_id uuid,
  target_event_key text,
  target_reason text
) returns public.employee_money_pay_period_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_row public.employee_money_ledger_entries;
  period_row public.pay_periods;
  before_row public.employee_money_pay_period_assignments;
  result public.employee_money_pay_period_assignments;
begin
  if nullif(btrim(target_event_key), '') is null or length(btrim(coalesce(target_reason, ''))) < 3 then
    raise exception 'employee_money_pay_period_input_invalid';
  end if;

  select * into entry_row from public.employee_money_ledger_entries where id = target_entry_id for update;
  if entry_row.id is null or entry_row.entry_type <> 'wage_paid'
    or not public.is_company_manager(entry_row.company_id) then
    raise exception 'employee_money_wage_entry_not_found_or_denied';
  end if;
  if entry_row.entry_status in ('rejected', 'reversed') then raise exception 'employee_money_entry_inactive'; end if;

  select * into period_row from public.pay_periods
  where id = target_pay_period_id and company_id = entry_row.company_id;
  if period_row.id is null then raise exception 'employee_money_pay_period_not_found'; end if;
  if period_row.status in ('closed', 'paying', 'paid', 'cancelled') then
    raise exception 'payroll_period_locked_use_adjustment';
  end if;

  select * into before_row from public.employee_money_pay_period_assignments
  where ledger_entry_id = entry_row.id for update;
  if before_row.pay_period_id = period_row.id then return before_row; end if;

  insert into public.employee_money_pay_period_assignments(
    company_id, ledger_entry_id, pay_period_id, assignment_method, reason, assigned_by
  ) values (
    entry_row.company_id, entry_row.id, period_row.id, 'admin_selected', btrim(target_reason), auth.uid()
  )
  on conflict(ledger_entry_id) do update set
    pay_period_id = excluded.pay_period_id,
    assignment_method = excluded.assignment_method,
    reason = excluded.reason,
    assigned_by = excluded.assigned_by,
    assigned_at = now(),
    version = public.employee_money_pay_period_assignments.version + 1,
    updated_at = now()
  returning * into result;

  insert into public.employee_money_ledger_audit(
    company_id, entry_id, event_key, action, actor_profile_id, before_data, after_data, reason
  ) values (
    entry_row.company_id, entry_row.id, target_event_key,
    case when before_row.id is null then 'pay_period_admin_assigned' else 'pay_period_admin_reassigned' end,
    auth.uid(), case when before_row.id is null then null else to_jsonb(before_row) end,
    to_jsonb(result), btrim(target_reason)
  );
  return result;
end;
$$;

revoke all on function public.assign_employee_money_pay_period(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.assign_employee_money_pay_period(uuid, uuid, text, text)
  to authenticated;

create or replace function public.auto_assign_employee_money_pay_period_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.auto_assign_employee_money_pay_period(
    new.id,
    'employee-money:pay-period:auto:' || new.id::text
  );
  return new;
end;
$$;

revoke all on function public.auto_assign_employee_money_pay_period_trigger()
  from public, anon, authenticated;

drop trigger if exists auto_assign_employee_money_pay_period_after_write
  on public.employee_money_ledger_entries;
create trigger auto_assign_employee_money_pay_period_after_write
after insert or update of effective_on, evidence_date_status, entry_status
on public.employee_money_ledger_entries
for each row execute function public.auto_assign_employee_money_pay_period_trigger();

create or replace view public.employee_money_ledger_detail_v1
with (security_invoker = true)
as
select
  entry.id,
  entry.company_id,
  entry.employee_profile_id,
  owner_profile.full_name as employee_name,
  allocation.received_by_profile_id,
  recipient_profile.full_name as received_by_name,
  allocation.recipient_relationship,
  coalesce(period_assignment.pay_period_id, allocation.pay_period_id) as pay_period_id,
  period.name as pay_period_name,
  period.starts_on as pay_period_starts_on,
  period.ends_on as pay_period_ends_on,
  period.status as pay_period_status,
  entry.source_name,
  entry.account_scope,
  entry.entry_type,
  entry.amount,
  entry.effective_on,
  transaction.transfer_at,
  transaction.bank_reference,
  transaction.sender_name,
  transaction.recipient_name,
  transaction.sender_bank_name,
  transaction.recipient_bank_name,
  transaction.sender_account_last4,
  transaction.recipient_account_last4,
  entry.financial_transaction_id,
  entry.source_flow_item_id,
  entry.allocation_id,
  entry.evidence_date_status,
  entry.match_method,
  entry.entry_status,
  entry.reason,
  entry.created_at,
  flow.target_department,
  flow.candidate_departments,
  flow.current_room,
  flow.state as flow_state,
  flow.assignment_status,
  entry.version,
  entry.reviewed_by,
  entry.reviewed_at,
  period_assignment.assignment_method as pay_period_assignment_method,
  period_assignment.reason as pay_period_assignment_reason
from public.employee_money_ledger_entries entry
join public.profiles owner_profile on owner_profile.id = entry.employee_profile_id
left join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
left join public.employee_money_pay_period_assignments period_assignment
  on period_assignment.ledger_entry_id = entry.id
left join public.profiles recipient_profile on recipient_profile.id = allocation.received_by_profile_id
left join public.pay_periods period
  on period.id = coalesce(period_assignment.pay_period_id, allocation.pay_period_id)
left join public.financial_transactions transaction on transaction.id = entry.financial_transaction_id
left join public.document_flow_items flow on flow.id = entry.source_flow_item_id;

revoke all on public.employee_money_ledger_detail_v1 from public, anon;
grant select on public.employee_money_ledger_detail_v1 to authenticated;

select public.auto_assign_employee_money_pay_period(
  entry.id,
  'employee-money:pay-period:backfill:' || entry.id::text
)
from public.employee_money_ledger_entries entry
where entry.entry_type = 'wage_paid'
  and entry.entry_status not in ('rejected', 'reversed')
  and entry.effective_on is not null
  and entry.evidence_date_status = 'verified';

comment on table public.employee_money_pay_period_assignments is
  'Canonical reviewed pay-period decision for employee-money ledger entries; transfer evidence remains immutable.';
