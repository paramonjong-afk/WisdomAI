create table if not exists public.line_ingestion_events (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id text not null unique,
  line_message_id text,
  source_message_id uuid references public.line_messages(id) on delete set null,
  source_type text,
  line_group_id text,
  line_user_id text,
  event_type text not null,
  message_type text,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'failed', 'skipped')),
  processing_stage text not null default 'webhook_received',
  attachment_status text not null default 'not_required'
    check (attachment_status in ('not_required', 'pending', 'saved', 'failed')),
  analysis_status text not null default 'not_required'
    check (analysis_status in ('not_required', 'pending', 'completed', 'fallback', 'failed')),
  output_type text,
  output_id uuid,
  is_redelivery boolean not null default false,
  error_message text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists line_ingestion_events_received_idx
  on public.line_ingestion_events(received_at desc);
create index if not exists line_ingestion_events_status_idx
  on public.line_ingestion_events(processing_status, received_at desc);
create index if not exists line_ingestion_events_group_idx
  on public.line_ingestion_events(line_group_id, received_at desc);

alter table public.line_ingestion_events enable row level security;

create policy "Managers read LINE ingestion events"
on public.line_ingestion_events for select to authenticated
using (public.is_work_manager());

comment on table public.line_ingestion_events is
  'End-to-end audit trail for every LINE webhook event. Secrets and binary contents are never stored here.';
