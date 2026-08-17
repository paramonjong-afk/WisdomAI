alter table public.drawing_ai_jobs
  add column if not exists pipeline_version text not null default 'wisdom-drawing-ensemble-v1',
  add column if not exists ensemble_result jsonb;

create table if not exists public.drawing_ai_model_registry (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  role text not null check (role in ('vision','ocr','reasoning','validator','ensemble')),
  availability text not null default 'candidate'
    check (availability in ('active','candidate','blocked_credit','needs_infrastructure','disabled')),
  cost_tier text not null default 'unknown'
    check (cost_tier in ('free','free_quota','paid','unknown')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, model, role)
);

create table if not exists public.drawing_ai_module_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.drawing_ai_jobs(id) on delete cascade,
  module_key text not null,
  module_version text not null,
  status text not null check (status in ('completed','warning','failed','skipped')),
  input_run_ids uuid[] not null default '{}',
  result jsonb,
  warnings text[] not null default '{}',
  latency_ms integer,
  created_at timestamptz not null default now(),
  unique (job_id, module_key, module_version)
);

insert into public.drawing_ai_model_registry (provider, model, role, availability, cost_tier, notes)
values
  ('wisdom', 'wisdom-drawing-ensemble-v1', 'ensemble', 'active', 'free', 'Deterministic consensus and validation over successful providers.'),
  ('google', 'gemini-3.5-flash', 'vision', 'active', 'free_quota', 'Current working PDF vision extractor.'),
  ('openai', 'gpt-5', 'reasoning', 'blocked_credit', 'paid', 'Challenger; activate when API quota is available.'),
  ('anthropic', 'claude-sonnet-4-5', 'reasoning', 'blocked_credit', 'paid', 'Challenger; activate when usage credits are available.'),
  ('mistral', 'mistral-ocr-latest', 'ocr', 'candidate', 'paid', 'Document OCR candidate with annotations and bounding boxes.'),
  ('paddleocr', 'PP-OCRv6', 'ocr', 'needs_infrastructure', 'free', 'Open-source OCR; requires a separate CPU/GPU worker.')
on conflict (provider, model, role) do update set
  availability = excluded.availability,
  cost_tier = excluded.cost_tier,
  notes = excluded.notes,
  updated_at = now();

alter table public.drawing_ai_model_registry enable row level security;
alter table public.drawing_ai_module_runs enable row level security;

create policy "Authenticated users read AI model registry" on public.drawing_ai_model_registry
  for select to authenticated using (true);
create policy "Authenticated users read AI module runs" on public.drawing_ai_module_runs
  for select to authenticated using (true);
create policy "Managers maintain AI model registry" on public.drawing_ai_model_registry
  for all to authenticated using (public.is_work_manager()) with check (public.is_work_manager());

create or replace view public.drawing_ai_champion
with (security_invoker = true)
as
select *
from (
  select
    provider, model, drawing_type, scored_runs, accuracy_score, average_latency_ms,
    row_number() over (
      partition by drawing_type
      order by case when scored_runs >= 5 then 0 else 1 end, accuracy_score desc, scored_runs desc
    ) as rank
  from public.drawing_ai_leaderboard
) ranked
where rank = 1;

comment on view public.drawing_ai_champion is
  'Best verified provider by drawing type; fewer than five scored runs remains provisional.';
