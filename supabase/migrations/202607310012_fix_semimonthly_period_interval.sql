create or replace function public.ensure_semimonthly_pay_periods(target_year integer, target_month integer)
returns setof public.pay_periods
language plpgsql security definer set search_path=public as $$
declare setting public.pay_cycle_settings;
declare month_start date;
declare month_end date;
declare first_end date;
declare first_pay date;
declare second_pay date;
declare created public.pay_periods;
begin
  if auth.uid() is not null and not public.is_work_manager() then raise exception 'Permission denied'; end if;
  if target_year not between 2000 and 2200 or target_month not between 1 and 12 then raise exception 'Invalid month'; end if;
  select * into setting from public.pay_cycle_settings where singleton=true;
  month_start:=make_date(target_year,target_month,1);
  month_end:=(month_start+interval '1 month'-interval '1 day')::date;
  first_end:=least(month_end,make_date(target_year,target_month,setting.first_period_end_day));
  first_pay:=public.adjust_pay_date(make_date(target_year,target_month,setting.first_pay_day),setting.holiday_adjustment);
  second_pay:=public.adjust_pay_date(
    (month_start+make_interval(months=>setting.second_pay_month_offset)
      +(setting.second_pay_day-1)*interval '1 day')::date,
    setting.holiday_adjustment
  );

  insert into public.pay_periods(name,starts_on,ends_on,pay_date)
  values(
    format('รอบ 1-%s %s',setting.first_period_end_day,to_char(month_start,'MM/YYYY')),
    month_start,first_end,first_pay
  ) on conflict(starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
  returning * into created;
  return next created;

  if first_end<month_end then
    insert into public.pay_periods(name,starts_on,ends_on,pay_date)
    values(
      format('รอบ %s-สิ้นเดือน %s',setting.first_period_end_day+1,to_char(month_start,'MM/YYYY')),
      first_end+1,month_end,second_pay
    ) on conflict(starts_on,ends_on) do update set pay_date=excluded.pay_date,updated_at=now()
    returning * into created;
    return next created;
  end if;
end;
$$;
