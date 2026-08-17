-- SYS-008: LINE and Voice task command center.
create table if not exists public.line_task_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(project_id) on delete set null,
  line_group_id text references public.line_groups(line_group_id) on delete set null,
  requester_line_user_id text not null references public.line_senders(line_user_id) on delete restrict,
  requester_profile_id uuid references public.profiles(id) on delete set null,
  source_message_id uuid references public.line_messages(id) on delete set null,
  source_type text not null check(source_type in ('text','voice')),
  transcript text,
  command_text text not null,
  title text not null,
  details text,
  command_type text not null default 'create_task' check(command_type in (
    'create_task','ask_issue','request_fix','request_approval','update_task','cancel_task'
  )),
  priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
  status text not null default 'awaiting_confirmation' check(status in (
    'awaiting_confirmation','awaiting_approval','queued','in_progress','blocked','completed','cancelled','rejected','expired'
  )),
  queue_position integer,
  confirmation_token text not null unique,
  confirmed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  decision_reason text,
  ai_provider text,
  ai_model text,
  ai_confidence numeric(5,4),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_task_commands_company_status_idx
  on public.line_task_commands(company_id,status,priority,created_at desc);
create index if not exists line_task_commands_requester_idx
  on public.line_task_commands(company_id,requester_profile_id,created_at desc);
create unique index if not exists line_task_commands_active_source_idx
  on public.line_task_commands(source_message_id)
  where source_message_id is not null and status not in ('cancelled','rejected','expired');

create table if not exists public.line_task_command_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  command_id uuid not null references public.line_task_commands(id) on delete cascade,
  actor_line_user_id text,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null check(event_type in (
    'received','transcribed','confirmation_requested','edited','confirmed','approval_requested',
    'approved','rejected','cancelled','priority_changed','queued','started','blocked','completed','expired','failed'
  )),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists line_task_command_events_command_idx
  on public.line_task_command_events(command_id,created_at);

alter table public.line_task_commands enable row level security;
alter table public.line_task_command_events enable row level security;

create policy "Members read own and managers read company LINE tasks"
  on public.line_task_commands for select to authenticated
  using(company_id=public.current_company_id() and (
    requester_profile_id=auth.uid() or public.is_company_manager(company_id)
  ));
create policy "Managers update company LINE tasks"
  on public.line_task_commands for update to authenticated
  using(company_id=public.current_company_id() and public.is_company_manager(company_id))
  with check(company_id=public.current_company_id() and public.is_company_manager(company_id));
create policy "Members read permitted LINE task history"
  on public.line_task_command_events for select to authenticated
  using(company_id=public.current_company_id() and exists(
    select 1 from public.line_task_commands command
    where command.id=command_id and (
      command.requester_profile_id=auth.uid() or public.is_company_manager(command.company_id)
    )
  ));

comment on table public.line_task_commands is
  'SYS-008 commands received from LINE text or voice. Every voice command requires explicit confirmation.';
