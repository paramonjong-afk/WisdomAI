alter table public.line_attachments
  add column if not exists content_sha256 text,
  add column if not exists duplicate_of uuid
    references public.line_attachments(id) on delete set null;

create index if not exists line_attachments_content_sha256_idx
  on public.line_attachments(content_sha256)
  where content_sha256 is not null;

comment on column public.line_attachments.content_sha256 is
  'SHA-256 of the original LINE attachment bytes for cross-group duplicate detection.';

comment on column public.line_attachments.duplicate_of is
  'First previously received attachment with identical bytes.';

with ranked as (
  select
    id,
    first_value(id) over (
      partition by image_sha256
      order by created_at, id
    ) as original_id,
    row_number() over (
      partition by image_sha256
      order by created_at, id
    ) as duplicate_rank
  from public.financial_transactions
  where image_sha256 is not null
    and review_status <> 'dismissed'
)
update public.financial_transactions target
set
  duplicate_of = ranked.original_id,
  review_status = 'duplicate',
  updated_at = now()
from ranked
where target.id = ranked.id
  and ranked.duplicate_rank > 1
  and target.review_status <> 'confirmed';

with ranked as (
  select
    id,
    first_value(id) over (
      partition by image_sha256
      order by created_at, id
    ) as original_id,
    row_number() over (
      partition by image_sha256
      order by created_at, id
    ) as duplicate_rank
  from public.accounting_documents
  where image_sha256 is not null
    and status <> 'dismissed'
)
update public.accounting_documents target
set
  duplicate_of = ranked.original_id,
  status = 'duplicate',
  updated_at = now()
from ranked
where target.id = ranked.id
  and ranked.duplicate_rank > 1
  and target.status <> 'confirmed';
