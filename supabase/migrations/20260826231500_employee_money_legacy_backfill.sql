-- Queue exact-name historical employee money evidence into the holding ledger.
-- Wage payments must already be Accounting-confirmed; advances remain pending
-- review. The projection never writes payroll or approves a ledger entry.
do $$
declare candidate record;
begin
  for candidate in
    select financial_transaction_id
    from public.employee_money_legacy_candidates
    where expense_type = 'advance'
       or (expense_type = 'labor' and review_status = 'confirmed')
    order by financial_transaction_id
  loop
    perform public.project_employee_money_source(
      candidate.financial_transaction_id,
      null,
      'legacy-employee-money-backfill:' || candidate.financial_transaction_id::text,
      null
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
