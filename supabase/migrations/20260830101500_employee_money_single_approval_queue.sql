-- Expose optimistic-lock and review metadata to the single employee-money approval queue.
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

comment on view public.employee_money_ledger_detail_v1 is
  'Canonical employee money detail ordered by real transfer time, including review version and immutable evidence links.';

notify pgrst,'reload schema';
