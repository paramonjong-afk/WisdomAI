-- Keep the high-level money destination within the lineage enum while the
-- concrete work queue remains employee_money_review_queue on the flow item.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid) into function_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reconcile_daily_employee_advance_route';

  if function_definition is null
    or function_definition not like '%next_destination = ''employee_money_review_queue''%'
  then raise exception 'reconcile_daily_employee_advance_route_unexpected_definition'; end if;

  function_definition := replace(
    function_definition,
    'next_destination = ''employee_money_review_queue''',
    'next_destination = ''advance_finance'''
  );
  execute function_definition;
end;
$migration$;

notify pgrst, 'reload schema';
