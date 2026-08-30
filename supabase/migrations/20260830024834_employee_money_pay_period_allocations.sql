-- Keep the transfer slip as immutable evidence while allowing one transfer to
-- be allocated to several employees and payroll periods.
alter table public.transfer_slip_money_allocations
  add column if not exists employee_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists received_by_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists pay_period_id uuid references public.pay_periods(id) on delete restrict,
  add column if not exists recipient_relationship text not null default 'self'
    check (recipient_relationship in ('self','received_for_other','team_lead','unknown'));

create index if not exists transfer_slip_money_allocations_employee_period_idx
  on public.transfer_slip_money_allocations(company_id, employee_profile_id, pay_period_id, status)
  where employee_profile_id is not null;

create or replace function public.hydrate_transfer_slip_employee_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_value text;
  recipient_value text;
  period_value text;
  relationship_value text;
  period_status text;
begin
  select evidence_item->>'value' into employee_value
  from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
  where evidence_item->>'field' = 'employee_profile_id'
  limit 1;
  select evidence_item->>'value' into recipient_value
  from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
  where evidence_item->>'field' = 'received_by_profile_id'
  limit 1;
  select evidence_item->>'value' into period_value
  from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
  where evidence_item->>'field' = 'pay_period_id'
  limit 1;
  select evidence_item->>'value' into relationship_value
  from jsonb_array_elements(coalesce(new.evidence, '[]'::jsonb)) evidence_item
  where evidence_item->>'field' = 'recipient_relationship'
  limit 1;

  new.employee_profile_id := nullif(employee_value, '')::uuid;
  new.received_by_profile_id := coalesce(nullif(recipient_value, '')::uuid, new.employee_profile_id);
  new.pay_period_id := nullif(period_value, '')::uuid;
  new.recipient_relationship := coalesce(nullif(relationship_value, ''),
    case when new.received_by_profile_id is distinct from new.employee_profile_id then 'received_for_other' else 'self' end);

  if new.purpose_type = 'payroll' and new.status in ('confirmed','routed','reconciled') then
    if new.employee_profile_id is null then raise exception 'payroll_employee_required'; end if;
    if new.pay_period_id is null then raise exception 'payroll_period_required'; end if;
    if not exists (
      select 1 from public.employee_employment_records employment
      where employment.company_id = new.company_id and employment.profile_id = new.employee_profile_id
    ) then raise exception 'payroll_employee_company_mismatch'; end if;
    if new.received_by_profile_id is not null and not exists (
      select 1 from public.company_members member
      where member.company_id = new.company_id and member.profile_id = new.received_by_profile_id
    ) then raise exception 'payroll_recipient_company_mismatch'; end if;
    select period.status into period_status
    from public.pay_periods period
    where period.id = new.pay_period_id and period.company_id = new.company_id;
    if period_status is null then raise exception 'payroll_period_company_mismatch'; end if;
    if period_status in ('closed','paying','paid','cancelled') then
      raise exception 'payroll_period_locked_use_adjustment';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.hydrate_transfer_slip_employee_allocation() from public, anon, authenticated;

drop trigger if exists hydrate_transfer_slip_employee_allocation_before_write
  on public.transfer_slip_money_allocations;
create trigger hydrate_transfer_slip_employee_allocation_before_write
before insert or update of evidence, purpose_type, status
on public.transfer_slip_money_allocations
for each row execute function public.hydrate_transfer_slip_employee_allocation();

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
  allocation.pay_period_id,
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
  entry.created_at
from public.employee_money_ledger_entries entry
join public.profiles owner_profile on owner_profile.id = entry.employee_profile_id
left join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
left join public.profiles recipient_profile on recipient_profile.id = allocation.received_by_profile_id
left join public.pay_periods period on period.id = allocation.pay_period_id
left join public.financial_transactions transaction on transaction.id = entry.financial_transaction_id;

revoke all on public.employee_money_ledger_detail_v1 from public, anon;
grant select on public.employee_money_ledger_detail_v1 to authenticated;

create or replace view public.employee_time_payroll_financial_summary_v1
with (security_invoker = true)
as
with ledger as (
  select
    entry.company_id,
    entry.employee_profile_id,
    allocation.pay_period_id,
    coalesce(sum(entry.amount) filter (
      where entry.entry_type = 'advance_issued' and entry.entry_status = 'approved'
    ), 0)::numeric(14,2) as advance_confirmed,
    coalesce(sum(entry.amount) filter (
      where entry.entry_type = 'wage_paid' and entry.entry_status = 'approved'
    ), 0)::numeric(14,2) as wage_paid_confirmed,
    coalesce(sum(entry.amount) filter (
      where entry.entry_status = 'matched_pending_review'
    ), 0)::numeric(14,2) as pending_review
  from public.employee_money_ledger_entries entry
  join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
  where entry.entry_status not in ('rejected','reversed')
  group by entry.company_id, entry.employee_profile_id, allocation.pay_period_id
)
select
  payroll.company_id,
  payroll.profile_id as employee_profile_id,
  profile.full_name as employee_name,
  payroll.pay_period_id,
  period.name as pay_period_name,
  period.starts_on,
  period.ends_on,
  period.pay_date,
  period.status as pay_period_status,
  payroll.status as payroll_status,
  payroll.normal_minutes,
  payroll.overtime_minutes,
  payroll.base_pay,
  payroll.overtime_pay,
  payroll.additions,
  payroll.deductions,
  payroll.reimbursements,
  payroll.net_pay,
  coalesce(ledger.advance_confirmed, 0)::numeric(14,2) as advance_confirmed,
  coalesce(ledger.wage_paid_confirmed, 0)::numeric(14,2) as wage_paid_confirmed,
  coalesce(ledger.pending_review, 0)::numeric(14,2) as pending_review,
  (payroll.net_pay - coalesce(ledger.advance_confirmed, 0) - coalesce(ledger.wage_paid_confirmed, 0))::numeric(14,2)
    as projected_remaining_pay
from public.employee_payrolls payroll
join public.pay_periods period on period.id = payroll.pay_period_id
join public.profiles profile on profile.id = payroll.profile_id
left join ledger on ledger.company_id = payroll.company_id
  and ledger.employee_profile_id = payroll.profile_id
  and ledger.pay_period_id = payroll.pay_period_id;

revoke all on public.employee_time_payroll_financial_summary_v1 from public, anon;
grant select on public.employee_time_payroll_financial_summary_v1 to authenticated;

comment on view public.employee_money_ledger_detail_v1 is
  'Read-only detail projection joining immutable transfer evidence, employee allocation and payroll period.';
comment on view public.employee_time_payroll_financial_summary_v1 is
  'Read-only payroll preview for time tracking. Closed payroll remains unchanged; corrections use adjustments.';
