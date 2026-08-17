-- Company-scoped display preferences only. Payroll and attendance calculations are unchanged.
alter table public.workforce_rule_settings
  add column if not exists work_time_primary_unit text not null default 'days',
  add column if not exists work_time_day_decimals smallint not null default 2,
  add column if not exists work_time_show_secondary_hours boolean not null default true;

alter table public.workforce_rule_settings
  drop constraint if exists workforce_rule_settings_work_time_primary_unit_check,
  add constraint workforce_rule_settings_work_time_primary_unit_check
    check (work_time_primary_unit in ('days','hours')),
  drop constraint if exists workforce_rule_settings_work_time_day_decimals_check,
  add constraint workforce_rule_settings_work_time_day_decimals_check
    check (work_time_day_decimals between 0 and 3);

comment on column public.workforce_rule_settings.work_time_primary_unit is
  'Display preference only: days or hours. Does not alter payroll calculation.';
comment on column public.workforce_rule_settings.work_time_day_decimals is
  'Decimal places when work duration is displayed as days.';
comment on column public.workforce_rule_settings.work_time_show_secondary_hours is
  'Show hours/minutes below the primary day value.';
