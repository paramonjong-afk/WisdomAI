-- Reconcile legacy transaction projections that describe the same wage fact as
-- a newer allocation projection. Preserve both rows and add an audit event.
do $$
declare
  duplicate_row record;
  before_row jsonb;
begin
  for duplicate_row in
    select distinct on (legacy.id)
      legacy.id as legacy_id,
      legacy.company_id,
      allocation_entry.id as replacement_id,
      allocation_entry.allocation_id as replacement_allocation_id
    from public.employee_money_ledger_entries legacy
    join public.employee_money_ledger_entries allocation_entry
      on allocation_entry.company_id = legacy.company_id
     and allocation_entry.financial_transaction_id = legacy.financial_transaction_id
     and allocation_entry.employee_profile_id = legacy.employee_profile_id
     and allocation_entry.entry_type = legacy.entry_type
     and allocation_entry.amount = legacy.amount
     and allocation_entry.allocation_id is not null
     and allocation_entry.entry_status not in ('rejected','reversed')
    where legacy.allocation_id is null
      and legacy.entry_status not in ('rejected','reversed')
    order by legacy.id, allocation_entry.created_at desc
  loop
    select to_jsonb(entry) into before_row
    from public.employee_money_ledger_entries entry
    where entry.id = duplicate_row.legacy_id;

    update public.employee_money_ledger_entries
    set entry_status = 'reversed',
        reviewed_at = now(),
        reason = 'แทนที่ Transaction projection เดิมด้วย Allocation projection ที่ยืนยันแล้ว',
        source_snapshot = source_snapshot || jsonb_build_object(
          'replaced_by_entry_id', duplicate_row.replacement_id,
          'replaced_by_allocation_id', duplicate_row.replacement_allocation_id,
          'projection_reconciled_at', now()),
        version = version + 1,
        updated_at = now()
    where id = duplicate_row.legacy_id
      and entry_status not in ('rejected','reversed');

    insert into public.employee_money_ledger_audit
      (company_id, entry_id, event_key, action, actor_profile_id, before_data, after_data, reason)
    select duplicate_row.company_id, entry.id,
      'employee-money-existing-projection:' || entry.id::text,
      'legacy_projection_reversed', null, before_row, to_jsonb(entry),
      'คงหลักฐานเดิม แต่ไม่นับยอดซ้ำกับ Allocation projection'
    from public.employee_money_ledger_entries entry
    where entry.id = duplicate_row.legacy_id
    on conflict(company_id,event_key) do nothing;
  end loop;
end;
$$;

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
  entry.created_at,
  flow.target_department,
  flow.candidate_departments,
  flow.current_room,
  flow.state as flow_state,
  flow.assignment_status
from public.employee_money_ledger_entries entry
join public.profiles owner_profile on owner_profile.id = entry.employee_profile_id
left join public.transfer_slip_money_allocations allocation on allocation.id = entry.allocation_id
left join public.profiles recipient_profile on recipient_profile.id = allocation.received_by_profile_id
left join public.pay_periods period on period.id = allocation.pay_period_id
left join public.financial_transactions transaction on transaction.id = entry.financial_transaction_id
left join public.document_flow_items flow on flow.id = entry.source_flow_item_id;

revoke all on public.employee_money_ledger_detail_v1 from public, anon;
grant select on public.employee_money_ledger_detail_v1 to authenticated;

comment on view public.employee_money_ledger_detail_v1 is
  'Canonical employee money detail with immutable evidence, allocation, pay period and department workflow.';

notify pgrst,'reload schema';
