do $$
declare
  target_table text;
  realtime_tables constant text[] := array[
    'employee_advance_holders',
    'employee_advance_holder_aliases',
    'employee_advance_cases',
    'employee_advance_settlement_items',
    'financial_transactions',
    'transfer_slip_money_lineages',
    'document_flow_destination_tasks'
  ];
begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    raise exception 'supabase_realtime_publication_not_found';
  end if;

  foreach target_table in array realtime_tables loop
    if to_regclass(format('public.%I',target_table)) is null then
      raise exception 'advance_holder_realtime_table_not_found:%',target_table;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I',target_table);
    end if;
  end loop;
end $$;
