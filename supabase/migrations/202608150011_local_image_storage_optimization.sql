-- Zero-API-cost image optimization queue. Processing is performed with
-- magick-wasm in an Edge Function, not Supabase Image Transformations.
alter table public.line_attachments
  add column if not exists thumbnail_storage_path text,
  add column if not exists optimization_status text not null default 'pending'
    check(optimization_status in ('pending','processing','optimized','kept_original','failed')),
  add column if not exists optimization_error text,
  add column if not exists storage_bytes_saved bigint not null default 0;

update public.line_attachments
set optimization_status=case
  when content_type like 'image/%' then 'pending'
  else 'kept_original'
end
where optimized_at is null;

create index if not exists line_attachments_optimization_queue_idx
on public.line_attachments(company_id,created_at)
where optimization_status in ('pending','failed');

create or replace view public.line_image_optimization_progress with (security_invoker=true) as
select company_id,count(*) filter(where content_type like 'image/%') total_images,
  count(*) filter(where optimization_status='optimized') optimized_images,
  count(*) filter(where optimization_status='kept_original') kept_original_images,
  count(*) filter(where optimization_status='failed') failed_images,
  count(*) filter(where optimization_status in ('pending','processing')) pending_images,
  coalesce(sum(storage_bytes_saved),0) storage_bytes_saved,
  max(optimized_at) last_optimized_at
from public.line_attachments group by company_id;
grant select on public.line_image_optimization_progress to authenticated;
notify pgrst,'reload schema';
