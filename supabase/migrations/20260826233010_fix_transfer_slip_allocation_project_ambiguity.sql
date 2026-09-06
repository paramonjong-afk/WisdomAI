-- Fix PL/pgSQL name collisions in transfer-slip allocation review.
-- The table columns project_id/site_id collided with local variables of the
-- same names and caused PostgreSQL error 42702 before an allocation was saved.
do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid)
  into function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'review_transfer_slip_money_lineage_v2'
    and pg_get_function_identity_arguments(p.oid) = 'target_item_id uuid, target_event_key text, target_decision text, target_transfer jsonb, target_lineage jsonb, target_allocations jsonb';

  if function_definition is null then
    raise exception 'review_transfer_slip_money_lineage_v2_not_found';
  end if;

  if function_definition not like '%  project_id uuid;%' or function_definition not like '%  site_id uuid;%' then
    raise exception 'review_transfer_slip_money_lineage_v2_unexpected_definition';
  end if;

  function_definition := replace(function_definition, '  project_id uuid;', '  allocation_project_id uuid;');
  function_definition := replace(function_definition, '  site_id uuid;', '  allocation_site_id uuid;');
  function_definition := replace(function_definition, '    project_id := nullif(allocation->>''project_id'', '''')::uuid;', '    allocation_project_id := nullif(allocation->>''project_id'', '''')::uuid;');
  function_definition := replace(function_definition, '    site_id := nullif(allocation->>''site_id'', '''')::uuid;', '    allocation_site_id := nullif(allocation->>''site_id'', '''')::uuid;');
  function_definition := replace(function_definition, 'and project_id is null then', 'and allocation_project_id is null then');
  function_definition := replace(function_definition, 'if project_id is not null and not exists(select 1 from public.projects p where p.id = project_id', 'if allocation_project_id is not null and not exists(select 1 from public.projects p where p.id = allocation_project_id');
  function_definition := replace(function_definition, 'if site_id is not null and not exists(select 1 from public.project_sites s where s.id = site_id', 'if allocation_site_id is not null and not exists(select 1 from public.project_sites s where s.id = allocation_site_id');
  function_definition := replace(function_definition, '(project_id is null or s.project_id = project_id)', '(allocation_project_id is null or s.project_id = allocation_project_id)');
  function_definition := replace(
    function_definition,
    'lineage_row.id, item_row.company_id, allocation_key_value, allocation_sequence, purpose, allocation_amount, project_id, site_id,',
    'lineage_row.id, item_row.company_id, allocation_key_value, allocation_sequence, purpose, allocation_amount, allocation_project_id, allocation_site_id,'
  );
  function_definition := replace(function_definition, 'and project_id is not null then', 'and allocation_project_id is not null then');

  if function_definition like '%  project_id uuid;%' or function_definition like '%  site_id uuid;%' then
    raise exception 'review_transfer_slip_money_lineage_v2_ambiguous_variables_remain';
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.review_transfer_slip_money_lineage_v2(uuid,text,text,jsonb,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
