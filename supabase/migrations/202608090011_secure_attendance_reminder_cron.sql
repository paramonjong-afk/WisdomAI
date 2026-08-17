-- Secure attendance reminder scheduler.
-- The credential is stored in Supabase Vault under attendance_monitor_secret;
-- no secret value is committed to source control or cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.invoke_attendance_reminders()
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
  where name = 'attendance_monitor_secret'
  order by updated_at desc
  limit 1;

  if monitor_secret is null or length(monitor_secret) < 32 then
    raise exception 'attendance_monitor_secret is missing or invalid';
  end if;

  select net.http_post(
    url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/attendance-reminders',
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

revoke all on function public.invoke_attendance_reminders() from public, anon, authenticated;
grant execute on function public.invoke_attendance_reminders() to postgres, service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname = 'wisdomai-attendance-reminders') then
    perform cron.unschedule('wisdomai-attendance-reminders');
  end if;

  perform cron.schedule(
    'wisdomai-attendance-reminders',
    '*/5 * * * *',
    'select public.invoke_attendance_reminders();'
  );
end
$$;

comment on function public.invoke_attendance_reminders() is
  'Invokes attendance-reminders with a Vault-backed monitor secret. Event idempotency prevents repeated LINE delivery.';
