-- Invoke the scheduled monitor once per enabled company. The credential stays
-- in Vault and each request carries an explicit tenant boundary.
create or replace function public.invoke_health_monitor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  monitor_secret text;
  target record;
  request_id bigint;
  last_request_id bigint;
begin
  select decrypted_secret into monitor_secret
  from vault.decrypted_secrets
  where name = 'health_monitor_secret'
  order by updated_at desc limit 1;

  if monitor_secret is null or length(monitor_secret) < 32 then
    raise exception 'health_monitor_secret is missing or invalid';
  end if;

  for target in
    select distinct settings.company_id
    from public.health_monitor_settings settings
    join public.companies company on company.id = settings.company_id
    where settings.enabled = true and settings.company_id is not null
  loop
    select net.http_post(
      url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/health-monitor',
      headers := jsonb_build_object('Content-Type','application/json','x-monitor-secret',monitor_secret),
      body := jsonb_build_object('source','pg_cron','company_id',target.company_id),
      timeout_milliseconds := 55000
    ) into request_id;
    last_request_id := request_id;
  end loop;

  return last_request_id;
end;
$$;

revoke all on function public.invoke_health_monitor() from public, anon, authenticated;
grant execute on function public.invoke_health_monitor() to postgres, service_role;

update public.system_work_items
set status='doing', progress=90, current_step='deploy_and_scheduled_smoke',
    production_status='migration_ready_for_production', updated_at=now(),
    evidence=concat_ws(E'\n',nullif(evidence,''),'202608110024: Scheduled monitor invokes one tenant-bound run per enabled company; browser background refresh is silent.')
where work_key='SYS-002';

comment on function public.invoke_health_monitor() is
  'Invokes health-monitor every five minutes once per enabled company using a Vault-backed secret.';
