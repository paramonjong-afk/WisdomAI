-- Separate a physical LINE blob from the logical attachment created for every message. Must precede retention lifecycle.
-- Applying this migration is intentionally left to the controlled deployment workflow.
create table if not exists public.line_attachment_blobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text not null default 'line-attachments',
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  original_size_bytes bigint,
  thumbnail_storage_path text,
  perceptual_hash text,
  created_at timestamptz not null default now(),
  unique(company_id,content_sha256),
  unique(storage_bucket,storage_path)
);

alter table public.line_attachments
  add column if not exists blob_id uuid references public.line_attachment_blobs(id) on delete restrict,
  add column if not exists near_duplicate_of uuid references public.line_attachments(id) on delete set null,
  add column if not exists near_duplicate_distance integer;

insert into public.line_attachment_blobs(
  company_id,content_sha256,storage_bucket,storage_path,content_type,size_bytes,
  original_size_bytes,thumbnail_storage_path
)
select distinct on (company_id,content_sha256)
  company_id,content_sha256,storage_bucket,storage_path,content_type,size_bytes,
  original_size_bytes,thumbnail_storage_path
from public.line_attachments
where company_id is not null and content_sha256 is not null
order by company_id,content_sha256,created_at,id
on conflict(company_id,content_sha256) do nothing;

update public.line_attachments attachment
set blob_id=blob.id
from public.line_attachment_blobs blob
where attachment.blob_id is null
  and blob.company_id=attachment.company_id
  and blob.content_sha256=attachment.content_sha256;

alter table public.line_attachments drop constraint if exists line_attachments_storage_path_key;

create unique index if not exists line_attachments_one_logical_attachment_per_message_idx
  on public.line_attachments(message_id);
create index if not exists line_attachments_blob_idx on public.line_attachments(blob_id);
create index if not exists line_attachment_blobs_perceptual_hash_idx
  on public.line_attachment_blobs(company_id,perceptual_hash)
  where perceptual_hash is not null;

comment on table public.line_attachment_blobs is
  'One physical object per company and SHA-256; LINE messages retain separate logical line_attachments rows.';
comment on column public.line_attachment_blobs.perceptual_hash is
  'Optional image perceptual hash used only to warn about near-duplicates; never an automatic deletion key.';

update public.system_work_items
set status='review',progress=85,
  evidence='DOC-INGEST-005 source implementation separates SHA-256 physical blobs from per-message logical attachments. Exact resends reuse one blob while continuing message history, project/work-summary processing, document-set membership, and cross-job links. Perceptual hash is reserved as warning-only metadata and never drives deletion; hash production and near-duplicate UI warning remain pending. Focused regressions and build passed. Full lint remains blocked by three pre-existing AccountingDocuments errors outside this work item; migration/deploy and authenticated resend UAT remain pending.',
  production_status='Migration 202608160020 and line-webhook deployment not applied; Production unchanged.',
  error_fingerprint=null,
  updated_at=now()
where work_key='DOC-INGEST-005';
