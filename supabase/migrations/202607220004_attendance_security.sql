drop policy if exists "Authenticated can read sites" on public.project_sites;
create policy "Users read assigned sites" on public.project_sites
for select to authenticated using (
  public.is_work_manager()
  or exists (
    select 1 from public.employee_site_assignments assignment
    where assignment.site_id = project_sites.id
      and assignment.profile_id = auth.uid()
      and assignment.active
      and assignment.starts_on <= current_date
      and (assignment.ends_on is null or assignment.ends_on >= current_date)
  )
);

drop policy if exists "Employees create attendance" on public.attendance_sessions;
drop policy if exists "Employees update open attendance" on public.attendance_sessions;

create policy "Managers read employee profiles" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_work_manager());

comment on table public.attendance_sessions is
'Attendance mutations are performed by the attendance-clock Edge Function using server timestamps.';
