alter table public.drawing_ai_jobs
  add column if not exists open_source_ocr jsonb;

comment on column public.drawing_ai_jobs.open_source_ocr is
  'OCR evidence produced by an open-source engine before multimodal provider analysis. It is supporting evidence and never an authoritative result by itself.';

insert into public.drawing_ai_model_registry
  (provider, model, role, availability, cost_tier, notes)
values
  ('tesseract', 'tesseract.js-7-eng-tha', 'ocr', 'active', 'free',
   'Browser-loaded open-source OCR for English and Thai images. Its text is supplied to vision providers as untrusted reference evidence.')
on conflict (provider, model, role) do update set
  availability = excluded.availability,
  cost_tier = excluded.cost_tier,
  notes = excluded.notes,
  updated_at = now();
