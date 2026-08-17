create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.health_monitor_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  line_group_id text references public.line_groups(line_group_id) on delete set null,
  responsible_name text,
  check_interval_minutes integer not null default 5 check (check_interval_minutes between 5 and 60),
  alert_after_failures integer not null default 2 check (alert_after_failures between 1 and 10),
  repeat_alert_minutes integer not null default 30 check (repeat_alert_minutes between 15 and 1440),
  daily_summary_time time not null default '08:00',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.health_monitor_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.health_monitor_checks (
  check_key text primary key,
  name_th text not null,
  module text not null,
  status text not null default 'unknown' check(status in ('healthy','warning','critical','unknown')),
  failure_count integer not null default 0,
  message text,
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.health_monitor_incidents (
  id uuid primary key default gen_random_uuid(),
  check_key text not null references public.health_monitor_checks(check_key) on delete cascade,
  severity text not null check(severity in ('warning','critical')),
  status text not null default 'open' check(status in ('open','resolved')),
  title text not null,
  message text,
  started_at timestamptz not null default now(),
  last_alerted_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists health_monitor_one_open_incident
  on public.health_monitor_incidents(check_key) where status='open';

create table if not exists public.health_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check(status in ('running','completed','failed','skipped')),
  healthy_count integer not null default 0,
  warning_count integer not null default 0,
  critical_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text
);

create table if not exists public.health_monitor_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null check(notification_type in ('incident','recovery','repeat','daily_summary','configuration')),
  incident_id uuid references public.health_monitor_incidents(id) on delete set null,
  destination text,
  status text not null check(status in ('sent','skipped','failed')),
  message text not null,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.health_monitor_settings enable row level security;
alter table public.health_monitor_checks enable row level security;
alter table public.health_monitor_incidents enable row level security;
alter table public.health_monitor_runs enable row level security;
alter table public.health_monitor_notifications enable row level security;

create policy "Managers read health settings" on public.health_monitor_settings
for select to authenticated using(public.is_work_manager());
create policy "Admins update health settings" on public.health_monitor_settings
for update to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and role='admin'))
with check(exists(select 1 from public.profiles where id=auth.uid() and role='admin'));
create policy "Managers read health checks" on public.health_monitor_checks
for select to authenticated using(public.is_work_manager());
create policy "Managers read health incidents" on public.health_monitor_incidents
for select to authenticated using(public.is_work_manager());
create policy "Managers read health runs" on public.health_monitor_runs
for select to authenticated using(public.is_work_manager());
create policy "Managers read health notifications" on public.health_monitor_notifications
for select to authenticated using(public.is_work_manager());

do $$
begin
  if exists(select 1 from cron.job where jobname='wisdomai-health-monitor') then
    perform cron.unschedule('wisdomai-health-monitor');
  end if;
  perform cron.schedule(
    'wisdomai-health-monitor',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://xkieyqixlufjqructjkr.supabase.co/functions/v1/health-monitor',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := '{"source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $job$
  );
end
$$;
