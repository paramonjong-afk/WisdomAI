-- One operational projection for transfer slips. Raw/OCR fields remain immutable
-- evidence and are never exposed as confirmed business values.
create or replace view public.transfer_slip_operational_truth_v1
with (security_invoker = true)
as
select
  task.id as task_id,
  task.status as task_status,
  task.created_at as task_created_at,
  item.id as item_id,
  item.company_id,
  item.intake_id,
  item.source_message_id,
  item.current_room,
  item.route_target,
  item.source_channel,
  item.source_room_name,
  item.source_sender_name,
  item.source_received_at,
  item.data_review_status,
  item.data_review_note,
  item.candidate_departments,
  tx.id as transaction_id,
  tx.review_status,
  tx.duplicate_of,
  tx.expense_type,
  tx.labor_amount,
  tx.payment_party_confidence,
  tx.analysis_confidence,
  tx.analysis_model,
  tx.notes,
  tx.sender_name as evidence_sender_name,
  tx.sender_bank_name as evidence_sender_bank_name,
  tx.sender_account_last4 as evidence_sender_account_last4,
  tx.recipient_name as evidence_recipient_name,
  tx.recipient_bank_name as evidence_recipient_bank_name,
  tx.recipient_account_last4 as evidence_recipient_account_last4,
  tx.amount_total as evidence_amount,
  tx.transfer_at as evidence_transfer_at,
  tx.bank_reference as evidence_bank_reference,
  lineage.id as lineage_id,
  lineage.version as lineage_version,
  lineage.funding_source_type,
  lineage.funding_source_reference,
  lineage.purpose_type,
  lineage.project_id,
  lineage.site_id,
  lineage.route_status,
  lineage.next_destination,
  lineage.confirmed_by,
  lineage.confirmed_at,
  case
    when tx.review_status = 'duplicate' or tx.duplicate_of is not null then 'duplicate'
    when lineage.confirmed_at is not null
      and lineage.route_status not in ('draft', 'needs_information') then 'confirmed'
    when lineage.route_status = 'needs_information' then 'needs_information'
    else 'needs_review'
  end as truth_status,
  case
    when lineage.confirmed_at is not null
      and lineage.route_status not in ('draft', 'needs_information')
      and tx.review_status <> 'duplicate'
      and tx.duplicate_of is null
    then true else false
  end as is_postable,
  case when lineage.confirmed_at is not null
    and lineage.route_status not in ('draft', 'needs_information')
    then lineage.payer_name end as canonical_payer_name,
  case when lineage.confirmed_at is not null
    and lineage.route_status not in ('draft', 'needs_information')
    then lineage.fund_holder_name end as canonical_fund_holder_name,
  case when lineage.confirmed_at is not null
    and lineage.route_status not in ('draft', 'needs_information')
    then lineage.final_beneficiary_name end as canonical_beneficiary_name,
  case when lineage.confirmed_at is not null
    and lineage.route_status not in ('draft', 'needs_information')
    then lineage.paid_amount end as canonical_amount
from public.document_flow_destination_tasks task
join public.document_flow_items item on item.id = task.item_id
left join public.financial_transactions tx
  on tx.source_message_id = item.source_message_id
  and tx.review_status <> 'dismissed'
left join public.transfer_slip_money_lineages lineage
  on lineage.item_id = item.id
where task.department = 'accounting'
  and item.document_type = 'transfer_slip';

revoke all on table public.transfer_slip_operational_truth_v1 from public, anon;
grant select on table public.transfer_slip_operational_truth_v1 to authenticated;

comment on view public.transfer_slip_operational_truth_v1 is
  'Single operational source for transfer slips. canonical_* is usable only when truth_status=confirmed and is_postable=true; evidence_* is immutable review evidence.';

notify pgrst, 'reload schema';
