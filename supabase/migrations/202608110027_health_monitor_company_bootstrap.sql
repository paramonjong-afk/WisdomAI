-- TEN-010 regression repair: every active company must own one Health Monitor setting row.

insert into public.health_monitor_settings(
  company_id,scope_key,singleton,enabled,responsible_name,
  check_interval_minutes,alert_after_failures,repeat_alert_minutes,daily_summary_time,
  line_group_id
)
select company.id,company.id::text,true,
  coalesce(global.enabled,true),global.responsible_name,
  coalesce(global.check_interval_minutes,5),coalesce(global.alert_after_failures,2),
  coalesce(global.repeat_alert_minutes,30),coalesce(global.daily_summary_time,'08:00'),
  null
from public.companies company
left join public.health_monitor_settings global on global.scope_key='global'
where company.active=true
on conflict(scope_key) do nothing;

create or replace function public.seed_company_singleton_settings()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into attendance_system_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  insert into pay_cycle_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  insert into workforce_rule_settings(company_id,singleton) values(new.id,true)
    on conflict(company_id,singleton) do nothing;
  insert into health_monitor_settings(
    company_id,scope_key,singleton,enabled,responsible_name,
    check_interval_minutes,alert_after_failures,repeat_alert_minutes,daily_summary_time,
    line_group_id
  )
  select new.id,new.id::text,true,
    coalesce(global.enabled,true),global.responsible_name,
    coalesce(global.check_interval_minutes,5),coalesce(global.alert_after_failures,2),
    coalesce(global.repeat_alert_minutes,30),coalesce(global.daily_summary_time,'08:00'),
    null
  from (select 1) seed
  left join health_monitor_settings global on global.scope_key='global'
  on conflict(scope_key) do nothing;
  return new;
end;
$$;

update public.system_work_items set
  status='doing',progress=75,current_step='health_monitor_company_bootstrap',
  evidence='Migration 202608110027 backfills missing company Health Monitor settings without copying another company LINE destination, and extends new-company bootstrap.',
  production_status='migration_ready_for_production',
  error_fingerprint='health_monitor.settings.missing_company_seed',updated_at=now()
where work_key='TEN-010';
