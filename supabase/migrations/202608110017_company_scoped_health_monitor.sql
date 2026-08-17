-- TEN-010: company-scoped Health Monitor state with an explicit global scope.

alter table public.health_monitor_settings add column if not exists id uuid default gen_random_uuid();
alter table public.health_monitor_settings add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.health_monitor_settings add column if not exists scope_key text;
update public.health_monitor_settings set scope_key=coalesce(company_id::text,'global') where scope_key is null;
update public.health_monitor_settings set id=gen_random_uuid() where id is null;
alter table public.health_monitor_settings alter column scope_key set not null;
alter table public.health_monitor_settings drop constraint if exists health_monitor_settings_pkey;
alter table public.health_monitor_settings add constraint health_monitor_settings_pkey primary key(id);
create unique index if not exists health_monitor_settings_scope_key on public.health_monitor_settings(scope_key);

insert into public.health_monitor_settings(company_id,scope_key,singleton,enabled,responsible_name,check_interval_minutes,alert_after_failures,repeat_alert_minutes,daily_summary_time)
select company.id,company.id::text,true,coalesce(global.enabled,true),global.responsible_name,
  coalesce(global.check_interval_minutes,5),coalesce(global.alert_after_failures,2),
  coalesce(global.repeat_alert_minutes,30),coalesce(global.daily_summary_time,'08:00')
from public.companies company
left join public.health_monitor_settings global on global.scope_key='global'
on conflict(scope_key) do nothing;

alter table public.health_monitor_checks add column if not exists id uuid default gen_random_uuid();
alter table public.health_monitor_checks add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.health_monitor_checks add column if not exists scope_key text;
update public.health_monitor_checks set scope_key=coalesce(company_id::text,'global') where scope_key is null;
update public.health_monitor_checks set id=gen_random_uuid() where id is null;
alter table public.health_monitor_checks alter column scope_key set not null;

alter table public.health_monitor_incidents add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.health_monitor_incidents add column if not exists check_id uuid;
update public.health_monitor_incidents incident set check_id=check_row.id,company_id=check_row.company_id
from public.health_monitor_checks check_row where incident.check_key=check_row.check_key and check_row.scope_key='global' and incident.check_id is null;
alter table public.health_monitor_incidents alter column check_id set not null;
alter table public.health_monitor_incidents drop constraint if exists health_monitor_incidents_check_key_fkey;
alter table public.health_monitor_checks drop constraint if exists health_monitor_checks_pkey;
alter table public.health_monitor_checks add constraint health_monitor_checks_pkey primary key(id);
alter table public.health_monitor_incidents add constraint health_monitor_incidents_check_id_fkey foreign key(check_id) references public.health_monitor_checks(id) on delete cascade;
create unique index if not exists health_monitor_checks_scope_key on public.health_monitor_checks(scope_key,check_key);
drop index if exists public.health_monitor_one_open_incident;
create unique index health_monitor_one_open_incident on public.health_monitor_incidents(check_id) where status='open';

alter table public.health_monitor_runs add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.health_monitor_notifications add column if not exists company_id uuid references public.companies(id) on delete cascade;

drop policy if exists "Managers read health settings" on public.health_monitor_settings;
drop policy if exists "Admins update health settings" on public.health_monitor_settings;
drop policy if exists "Managers read health checks" on public.health_monitor_checks;
drop policy if exists "Managers read health incidents" on public.health_monitor_incidents;
drop policy if exists "Managers read health runs" on public.health_monitor_runs;

create policy "Company managers read health settings" on public.health_monitor_settings for select to authenticated using(
  (company_id is not null and public.is_company_manager(company_id)) or
  (company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
);
create policy "Company admins update health settings" on public.health_monitor_settings for update to authenticated using(
  company_id is not null and public.is_company_manager(company_id)
) with check(company_id is not null and public.is_company_manager(company_id));
create policy "Company managers read health checks" on public.health_monitor_checks for select to authenticated using(
  (company_id is not null and public.is_company_manager(company_id)) or
  (company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
);
create policy "Company managers read health incidents" on public.health_monitor_incidents for select to authenticated using(
  (company_id is not null and public.is_company_manager(company_id)) or
  (company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
);
create policy "Company managers read health runs" on public.health_monitor_runs for select to authenticated using(
  (company_id is not null and public.is_company_manager(company_id)) or
  (company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
);

update public.system_work_items set status='doing',progress=65,current_step='migration_and_source_update',
  production_status='migration_ready_for_production',updated_at=now(),
  evidence='TEN-010 adds explicit global/company scopes to settings, checks, incidents, runs and notifications with company-manager RLS.'
where work_key='TEN-010';
