-- Stream authoritative work-item changes to authenticated dashboards.
-- The guard keeps this migration safe when Realtime was enabled manually.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'system_work_items'
  ) then
    alter publication supabase_realtime
      add table public.system_work_items;
  end if;
end
$$;

comment on table public.system_work_items is
  'Authoritative work status source consumed by Web, LINE, Telegram, automation, and Realtime dashboards.';
