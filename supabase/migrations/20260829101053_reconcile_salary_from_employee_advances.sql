create or replace function public.reconcile_confirmed_salary_employee_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  advance_before public.employee_advance_cases;
  advance_after public.employee_advance_cases;
begin
  if new.status <> 'confirmed'
     or new.purpose_type <> 'payroll'
     or not coalesce(new.evidence, '[]'::jsonb) @> '[{"field":"payroll_kind","value":"salary"}]'::jsonb then
    return new;
  end if;

  for advance_before in
    select advance.*
    from public.employee_advance_cases advance
    join public.transfer_slip_money_lineages lineage
      on lineage.id = new.lineage_id
     and lineage.transaction_id = advance.financial_transaction_id
    where advance.status in ('draft', 'collecting_evidence', 'submitted', 'under_review', 'returned')
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
    where id = advance_before.id
    returning * into advance_after;

    insert into public.employee_advance_audit(
      case_id,
      company_id,
      event_key,
      action,
      actor_profile_id,
      before_data,
      after_data,
      reason
    ) values (
      advance_before.id,
      advance_before.company_id,
      'salary-reclassification-cancel-advance:' || advance_before.id::text || ':' || new.id::text,
      'advance_cancelled_after_salary_confirmation',
      new.confirmed_by,
      to_jsonb(advance_before),
      to_jsonb(advance_after) || jsonb_build_object(
        'salary_allocation_id', new.id,
        'salary_lineage_id', new.lineage_id,
        'payroll_kind', 'salary'
      ),
      'Admin ยืนยันว่าเป็นเงินเดือน ไม่ใช่เงินสำรองจ่ายหรือเงินเบิกล่วงหน้า'
    )
    on conflict(event_key) do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.reconcile_confirmed_salary_employee_advance() from public, anon, authenticated;

drop trigger if exists reconcile_confirmed_salary_employee_advance
on public.transfer_slip_money_allocations;

create trigger reconcile_confirmed_salary_employee_advance
after insert or update of purpose_type, status, evidence
on public.transfer_slip_money_allocations
for each row
execute function public.reconcile_confirmed_salary_employee_advance();

-- Reconcile historical active advances that were created before the salary decision.
update public.transfer_slip_money_allocations allocation
set updated_at = allocation.updated_at
where allocation.status = 'confirmed'
  and allocation.purpose_type = 'payroll'
  and coalesce(allocation.evidence, '[]'::jsonb) @> '[{"field":"payroll_kind","value":"salary"}]'::jsonb
  and exists (
    select 1
    from public.transfer_slip_money_lineages lineage
    join public.employee_advance_cases advance
      on advance.financial_transaction_id = lineage.transaction_id
    where lineage.id = allocation.lineage_id
      and advance.status in ('draft', 'collecting_evidence', 'submitted', 'under_review', 'returned')
  );

comment on function public.reconcile_confirmed_salary_employee_advance() is
  'Cancels only unfinalized employee advance cases when an Admin-confirmed allocation is salary; preserves source evidence and appends advance audit.';
