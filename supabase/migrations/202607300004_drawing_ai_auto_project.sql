alter table public.drawing_ai_jobs alter column project_id drop not null;

alter table public.drawing_ai_jobs drop constraint if exists drawing_ai_jobs_status_check;
alter table public.drawing_ai_jobs add constraint drawing_ai_jobs_status_check
  check (status in ('queued','processing','completed','partial','failed','needs_project','verified'));

alter table public.drawing_ai_jobs
  add column if not exists detected_project_name text,
  add column if not exists detected_project_code text,
  add column if not exists project_detection_source jsonb;
