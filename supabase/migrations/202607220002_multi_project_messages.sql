alter table public.line_groups
  add column if not exists group_mode text not null default 'dedicated'
  check (group_mode in ('dedicated', 'multi_project'));

comment on column public.line_groups.project_id is 'Default project for a dedicated group. Multi-project groups may leave this null.';

create table if not exists public.line_message_projects (
  message_id uuid not null references public.line_messages(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  assignment_source text not null default 'manual'
    check (assignment_source in ('hashtag', 'group_default', 'reply_context', 'manual')),
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (message_id, project_id)
);

create index if not exists line_message_projects_project_idx
  on public.line_message_projects(project_id, created_at desc);

alter table public.line_message_projects enable row level security;

create policy "Authenticated users can read message project mappings"
on public.line_message_projects for select to authenticated using (true);

create policy "Managers can classify messages"
on public.line_message_projects for insert to authenticated
with check (public.is_work_manager() and assigned_by = auth.uid());

create policy "Managers can remove message classifications"
on public.line_message_projects for delete to authenticated
using (public.is_work_manager());

comment on table public.line_message_projects is
  'Many-to-many project assignments. One LINE message may belong to multiple projects.';
