alter table public.work_summary_items
  add column if not exists urgency text not null default 'low'
    check (urgency in ('low', 'medium', 'high', 'critical')),
  add column if not exists analysis_confidence numeric(4, 3),
  add column if not exists analysis_provider text not null default 'rules'
    check (analysis_provider in ('rules', 'gemini')),
  add column if not exists analysis_model text,
  add column if not exists analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'completed', 'fallback')),
  add column if not exists analysis_error text,
  add column if not exists analyzed_at timestamptz;

alter table public.line_message_projects
  drop constraint if exists line_message_projects_assignment_source_check;

alter table public.line_message_projects
  add constraint line_message_projects_assignment_source_check
  check (assignment_source in ('hashtag', 'group_default', 'reply_context', 'manual', 'ai'));

create index if not exists work_summary_items_analysis_status_idx
  on public.work_summary_items(analysis_status, work_date desc);

comment on column public.work_summary_items.analysis_provider is
  'gemini when AI structured analysis succeeds; rules when the free quota or provider is unavailable.';
comment on column public.work_summary_items.analysis_error is
  'Short server-side diagnostic. Never contains API keys.';
