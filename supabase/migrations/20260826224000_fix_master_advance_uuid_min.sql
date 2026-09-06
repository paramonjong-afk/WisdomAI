-- Fix the employee-advance confirmation RPC for PostgreSQL UUID values.
-- PostgreSQL has no built-in min(uuid) aggregate. The old RPC used min(uuid)
-- while resolving an optional employee match, so a valid confirmation rolled
-- back before any candidate, pair, Accounting task, lineage or Audit write.
-- Keep the same deterministic behavior by selecting the first UUID from an
-- ordered distinct array. Raw/OCR/source rows remain untouched.

do $$
declare
  function_sql text;
begin
  select pg_get_functiondef(
    'public.confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text)'::regprocedure
  ) into function_sql;

  if position('min(employment.profile_id)' in function_sql) = 0
     or position('min(person.id)' in function_sql) = 0 then
    raise exception 'master advance RPC source does not contain the expected UUID aggregate';
  end if;

  function_sql := replace(
    function_sql,
    'min(employment.profile_id)',
    '(array_agg(distinct employment.profile_id order by employment.profile_id))[1]'
  );
  function_sql := replace(
    function_sql,
    'min(person.id)',
    '(array_agg(distinct person.id order by person.id))[1]'
  );

  execute function_sql;
end;
$$;

comment on function public.confirm_master_data_employee_advance_funding(uuid,text,text,text,text,text) is
  'Confirms an employee/technician bank-account candidate as advance funding without fabricating a Project; routes Accounting first, preserves raw evidence and leaves Project allocation for settlement. UUID employee matching uses deterministic ordered array selection.';

notify pgrst,'reload schema';

-- Rollback/recovery: restore migration 20260826190500 version of the RPC only
-- if required. Existing source, candidate, pair, task, lineage, version and
-- Audit rows are retained; never delete or rewrite Raw/OCR evidence.
