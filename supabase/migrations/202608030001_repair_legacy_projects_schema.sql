-- Keep the legacy project columns for older integrations, while exposing the
-- canonical columns used by the current web app and its related modules.
alter table public.projects
  add column if not exists id uuid,
  add column if not exists name text,
  add column if not exists code text,
  add column if not exists status text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.projects
set id = gen_random_uuid()
where id is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'project_name'
  ) then
    execute $sql$
      update public.projects
      set name = coalesce(nullif(btrim(project_name::text), ''), 'โครงการ ' || left(id::text, 8))
      where name is null or btrim(name) = ''
    $sql$;
  else
    update public.projects
    set name = 'โครงการ ' || left(id::text, 8)
    where name is null or btrim(name) = '';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'project_code'
  ) then
    execute $sql$
      update public.projects
      set code = nullif(upper(btrim(project_code::text)), '')
      where code is null
    $sql$;
  end if;
end
$$;

update public.projects
set status = 'active'
where status is null or status not in ('active', 'paused', 'completed', 'archived');

alter table public.projects
  alter column id set default gen_random_uuid(),
  alter column id set not null,
  alter column name set not null,
  alter column status set default 'active',
  alter column status set not null;

create unique index if not exists projects_canonical_id_uidx on public.projects(id);
create unique index if not exists projects_canonical_code_uidx
  on public.projects(code)
  where code is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_canonical_status_check'
  ) then
    alter table public.projects
      add constraint projects_canonical_status_check
      check (status in ('active', 'paused', 'completed', 'archived'));
  end if;
end
$$;

drop policy if exists "Authenticated users can read work projects" on public.projects;
create policy "Authenticated users can read work projects"
  on public.projects for select to authenticated using (true);

drop policy if exists "Managers can create work projects" on public.projects;
create policy "Managers can create work projects"
  on public.projects for insert to authenticated
  with check (public.is_work_manager() and created_by = auth.uid());

drop policy if exists "Managers can update work projects" on public.projects;
create policy "Managers can update work projects"
  on public.projects for update to authenticated
  using (public.is_work_manager()) with check (public.is_work_manager());

comment on column public.projects.id is 'Canonical project identifier used by current WisdomAI modules.';
comment on column public.projects.name is 'Canonical project name, synchronized initially from legacy project_name.';
comment on column public.projects.code is 'Canonical project code, synchronized initially from legacy project_code.';

notify pgrst, 'reload schema';
