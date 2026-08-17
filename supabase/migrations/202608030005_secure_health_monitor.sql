do $$
begin
  if exists(select 1 from cron.job where jobname='wisdomai-health-monitor') then
    perform cron.unschedule('wisdomai-health-monitor');
  end if;
end
$$;
