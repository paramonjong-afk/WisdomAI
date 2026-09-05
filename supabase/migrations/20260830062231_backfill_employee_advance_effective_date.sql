-- Promote a valid immutable transfer timestamp into the derived ledger date.
-- This repairs old projections only; the source transaction and slip remain unchanged.
do $$
declare
  target_row record;
  before_row jsonb;
begin
  for target_row in
    select entry.id, entry.company_id,
      (transaction.transfer_at at time zone 'Asia/Bangkok')::date as transfer_date
    from public.employee_money_ledger_entries entry
    join public.financial_transactions transaction on transaction.id = entry.financial_transaction_id
    where entry.entry_type = 'advance_issued'
      and entry.entry_status not in ('rejected', 'reversed')
      and (entry.effective_on is null or entry.evidence_date_status <> 'verified')
      and transaction.transfer_at is not null
      and extract(year from transaction.transfer_at at time zone 'Asia/Bangkok') between 2000 and extract(year from current_date) + 1
  loop
    select to_jsonb(entry) into before_row
    from public.employee_money_ledger_entries entry
    where entry.id = target_row.id;

    update public.employee_money_ledger_entries
    set effective_on = target_row.transfer_date,
        evidence_date_status = 'verified',
        reason = 'ยืนยันวันที่ Derived Ledger จากวันเวลาโอนจริงใน Financial Transaction',
        source_snapshot = source_snapshot || jsonb_build_object(
          'effective_date_source', 'financial_transactions.transfer_at',
          'effective_date_repaired_at', now()),
        version = version + 1,
        updated_at = now()
    where id = target_row.id;

    insert into public.employee_money_ledger_audit(
      company_id, entry_id, event_key, action, actor_profile_id,
      before_data, after_data, reason
    )
    select target_row.company_id, entry.id,
      'employee-money:effective-date-from-transfer:' || entry.id::text,
      'effective_date_verified_from_transfer', null, before_row, to_jsonb(entry),
      'ใช้วันเวลาโอนจริงจาก Financial Transaction เพื่อผูกงวด โดยไม่แก้หลักฐานต้นฉบับ'
    from public.employee_money_ledger_entries entry
    where entry.id = target_row.id
    on conflict(company_id, event_key) do nothing;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
