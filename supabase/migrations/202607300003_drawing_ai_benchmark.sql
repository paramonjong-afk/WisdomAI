create table if not exists public.drawing_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  drawing_type text not null default 'mixed'
    check (drawing_type in ('architectural','structural','electrical','plumbing','hvac','fire_alarm','solar','civil','mixed')),
  storage_path text not null unique,
  mime_type text not null,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','partial','failed','verified')),
  requested_providers text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drawing_ai_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  provider text not null check (provider in ('gemini','openai','anthropic')),
  model text not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  result jsonb,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, provider, model)
);

create table if not exists public.drawing_ai_ground_truth (
  job_id uuid primary key references public.drawing_ai_jobs(id) on delete cascade,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  notes text,
  verified_by uuid not null references public.profiles(id) on delete restrict,
  verified_at timestamptz not null default now()
);

create table if not exists public.drawing_ai_scores (
  run_id uuid primary key references public.drawing_ai_runs(id) on delete cascade,
  item_precision numeric(7,4) not null check (item_precision between 0 and 1),
  item_recall numeric(7,4) not null check (item_recall between 0 and 1),
  quantity_accuracy numeric(7,4) not null check (quantity_accuracy between 0 and 1),
  unit_accuracy numeric(7,4) not null check (unit_accuracy between 0 and 1),
  evidence_accuracy numeric(7,4) not null check (evidence_accuracy between 0 and 1),
  weighted_score numeric(7,4) generated always as (
    item_precision * 0.20 + item_recall * 0.25 + quantity_accuracy * 0.30 +
    unit_accuracy * 0.15 + evidence_accuracy * 0.10
  ) stored,
  scored_at timestamptz not null default now()
);

create index if not exists drawing_ai_jobs_project_idx on public.drawing_ai_jobs(project_id, created_at desc);
create index if not exists drawing_ai_runs_job_idx on public.drawing_ai_runs(job_id, provider);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'drawing-ai', 'drawing-ai', false, 52428800,
  array['application/pdf','image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.drawing_ai_jobs enable row level security;
alter table public.drawing_ai_runs enable row level security;
alter table public.drawing_ai_ground_truth enable row level security;
alter table public.drawing_ai_scores enable row level security;

create policy "Authenticated users read drawing AI jobs" on public.drawing_ai_jobs
  for select to authenticated using (true);
create policy "Authenticated users read drawing AI runs" on public.drawing_ai_runs
  for select to authenticated using (true);
create policy "Authenticated users read drawing AI truth" on public.drawing_ai_ground_truth
  for select to authenticated using (true);
create policy "Authenticated users read drawing AI scores" on public.drawing_ai_scores
  for select to authenticated using (true);
create policy "Managers maintain drawing AI jobs" on public.drawing_ai_jobs
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain drawing AI truth" on public.drawing_ai_ground_truth
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers maintain drawing AI scores" on public.drawing_ai_scores
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());
create policy "Managers upload drawings" on storage.objects
  for insert to authenticated with check (bucket_id = 'drawing-ai' and public.is_work_manager());
create policy "Authenticated users view drawings" on storage.objects
  for select to authenticated using (bucket_id = 'drawing-ai');

create or replace view public.drawing_ai_leaderboard
with (security_invoker = true)
as
select
  r.provider, r.model, j.drawing_type,
  count(s.run_id)::integer as scored_runs,
  avg(s.weighted_score)::numeric(7,4) as accuracy_score,
  avg(r.latency_ms)::integer as average_latency_ms
from public.drawing_ai_runs r
join public.drawing_ai_jobs j on j.id = r.job_id
join public.drawing_ai_scores s on s.run_id = r.id
group by r.provider, r.model, j.drawing_type;

comment on view public.drawing_ai_leaderboard is
  'Accuracy is based only on human-verified ground truth, never model self-confidence.';
