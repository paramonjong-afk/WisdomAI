alter table public.app_activity_logs drop constraint if exists app_activity_logs_event_type_check;
alter table public.app_activity_logs add constraint app_activity_logs_event_type_check check(event_type in(
  'session_start','session_end','page_view','client_error','request_error','export_data'
));

alter table public.app_activity_logs add column if not exists company_id uuid references public.companies(id);
update public.app_activity_logs set company_id=(select id from public.companies where slug='wisdomai-default') where company_id is null;
alter table public.app_activity_logs alter column company_id set not null;
create index if not exists app_activity_logs_company_created_idx on public.app_activity_logs(company_id,created_at desc);

drop trigger if exists assign_company_app_activity_logs on public.app_activity_logs;
create trigger assign_company_app_activity_logs before insert on public.app_activity_logs
for each row execute function public.assign_current_company();
drop trigger if exists enforce_company_write_app_activity_logs on public.app_activity_logs;
create trigger enforce_company_write_app_activity_logs before insert or update or delete on public.app_activity_logs
for each row execute function public.enforce_company_write_boundary();

drop policy if exists tenant_isolation_app_activity_logs on public.app_activity_logs;
create policy tenant_isolation_app_activity_logs on public.app_activity_logs as restrictive for all to authenticated
using(company_id=public.current_company_id()) with check(company_id=public.current_company_id());
