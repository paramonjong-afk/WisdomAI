-- Resolve an advance recipient using employment eligibility on the transfer
-- date. A later resignation must not make an earlier valid slip unmatchable.

do $migration$
declare
  function_definition text;
  old_eligibility text := 'and employment.employment_status in (''active'',''probation'',''notice'')';
  new_eligibility text := 'and (employment.employment_status in (''active'',''probation'',''notice'') or (employment.employment_status = ''terminated'' and transaction_row.transfer_at is not null and coalesce(employment.payroll_eligible_until, employment.last_working_on, employment.terminated_on) >= (transaction_row.transfer_at at time zone ''Asia/Bangkok'')::date))';
begin
  select pg_get_functiondef(p.oid) into function_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='resolve_transfer_slip_advance_parties'
    and pg_get_function_identity_arguments(p.oid)='target_item_id uuid, target_event_key text, target_apply boolean';

  if function_definition is null then
    raise exception 'resolve_transfer_slip_advance_parties_not_found';
  end if;
  if (length(function_definition)-length(replace(function_definition,old_eligibility,'')))/length(old_eligibility) <> 1 then
    raise exception 'resolve_transfer_slip_advance_parties_unexpected_eligibility_definition';
  end if;

  execute replace(function_definition,old_eligibility,new_eligibility);
end;
$migration$;

notify pgrst,'reload schema';

-- Rollback: restore the current-status-only predicate in
-- resolve_transfer_slip_advance_parties. Do not alter employment history,
-- source transactions, party links, bank facts or workflow audit.
