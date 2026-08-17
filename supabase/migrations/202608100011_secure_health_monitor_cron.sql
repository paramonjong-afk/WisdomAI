-- Secure 24-hour health monitor scheduler. The credential must exist both as
-- the Edge Function secret HEALTH_MONITOR_SECRET and in Supabase Vault under
-- health_monitor_secret. No secret value is committed to source or cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.bootstrap_health_monitor_vault_secret(secret_value text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_id uuid;
begin
  if secret_value is null or length(secret_value) < 32 then
    raise exception 'health monitor secret is missing or invalid';
  end if;

  select id into existing_id from vault.secrets
  where name = 'health_monitor_secret'
  order by created_at desc
  limit 1;

  if existing_id is null then
    perform vault.create_secret(secret_value, 'health_monitor_secret', 'WisdomAI health monitor cron credential');
  else
    perform vault.update_secret(existing_id, secret_value, 'health_monitor_secret', 'WisdomAI health monitor cron credential');
  end if;
end;
$$;

revoke all on function public.bootstrap_health_monitor_vault_secret(text) from public, anon, authenticated;
grant execute on function public.bootstrap_health_monitor_vault_secret(text) to service_role;

create or replace function public.invoke_health_monitor()
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  monitor_secret text;
  request_id bigint;
begin
  select decrypted_secret
    into monitor_secret
  from vault.decrypted_secrets
  where name = 'health_monitor_secret'
  order by updated_at desc
  limit 1;

  if monitor_secret is null or length(monitor_secret) < 32 then
    raise exception 'health_monitor_secret is missing or invalid';
  end if;

  select net.http_post(
    url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/health-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monitor-secret', monitor_secret
    ),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.invoke_health_monitor() from public, anon, authenticated;
grant execute on function public.invoke_health_monitor() to postgres, service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname = 'wisdomai-health-monitor') then
    perform cron.unschedule('wisdomai-health-monitor');
  end if;

  perform cron.schedule(
    'wisdomai-health-monitor',
    '*/5 * * * *',
    'select public.invoke_health_monitor();'
  );
end
$$;

comment on function public.invoke_health_monitor() is
  'Invokes health-monitor every five minutes using a Vault-backed secret.';
