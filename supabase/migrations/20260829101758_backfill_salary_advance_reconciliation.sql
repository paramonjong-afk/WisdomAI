do $$
declare
  candidate record;
  advance_after public.employee_advance_cases;
begin
  for candidate in
    select advance.*,
           allocation.id as salary_allocation_id,
           allocation.lineage_id as salary_lineage_id,
           allocation.confirmed_by as salary_confirmed_by
    from public.employee_advance_cases advance
    join public.transfer_slip_money_lineages lineage
      on lineage.transaction_id = advance.financial_transaction_id
    join public.transfer_slip_money_allocations allocation
      on allocation.lineage_id = lineage.id
    where advance.status in ('draft', 'collecting_evidence', 'submitted', 'under_review', 'returned')
      and allocation.status = 'confirmed'
      and allocation.purpose_type = 'payroll'
      and coalesce(allocation.evidence, '[]'::jsonb) @> '[{"field":"payroll_kind","value":"salary"}]'::jsonb
    for update of advance
  loop
    update public.employee_advance_cases
    set status = 'cancelled',
        purpose_note = concat_ws(
          ' · ',
          nullif(purpose_note, ''),
          'ยกเลิกอัตโนมัติ: Admin ยืนยันสลิปเป็นเงินเดือน จึงไม่ใช่เงินทดรอง'
        ),
        version = version + 1,
        updated_at = now()
    where id = candidate.id
    returning * into advance_after;

    insert into public.employee_advance_audit(
      case_id, company_id, event_key, action, actor_profile_id,
      before_data, after_data, reason
    ) values (
      candidate.id,
      candidate.company_id,
      'salary-reclassification-cancel-advance:' || candidate.id::text || ':' || candidate.salary_allocation_id::text,
      'advance_cancelled_after_salary_confirmation',
      candidate.salary_confirmed_by,
      to_jsonb(candidate) - 'salary_allocation_id' - 'salary_lineage_id' - 'salary_confirmed_by',
      to_jsonb(advance_after) || jsonb_build_object(
        'salary_allocation_id', candidate.salary_allocation_id,
        'salary_lineage_id', candidate.salary_lineage_id,
        'payroll_kind', 'salary'
      ),
      'Admin ยืนยันว่าเป็นเงินเดือน ไม่ใช่เงินสำรองจ่ายหรือเงินเบิกล่วงหน้า'
    )
    on conflict(event_key) do nothing;
  end loop;
end;
$$;
