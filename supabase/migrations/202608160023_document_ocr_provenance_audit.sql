-- DOC-INGEST-010: immutable file/OCR provenance and field-level correction audit.
-- Source-only change: apply through the controlled migration workflow after review.

create table if not exists public.document_processing_audits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  intake_id uuid,
  document_id uuid references public.accounting_documents(id) on delete set null,
  message_id uuid references public.line_messages(id) on delete set null,
  attachment_id uuid references public.line_attachments(id) on delete set null,
  page_number integer not null default 1 check (page_number > 0),
  width_px integer check (width_px > 0),
  height_px integer check (height_px > 0),
  dpi_x numeric check (dpi_x > 0),
  dpi_y numeric check (dpi_y > 0),
  orientation_degrees integer check (orientation_degrees in (0,90,180,270)),
  original_sha256 text check (original_sha256 is null or original_sha256 ~ '^[0-9a-f]{64}$'),
  optimized_sha256 text check (optimized_sha256 is null or optimized_sha256 ~ '^[0-9a-f]{64}$'),
  perceptual_hash text,
  quality_score numeric check (quality_score between 0 and 1),
  quality_metrics jsonb not null default '{}'::jsonb,
  transform_recipe jsonb not null default '{}'::jsonb,
  transform_version text not null,
  ocr_engine text not null,
  ocr_model text not null,
  ocr_version text not null,
  page_confidence numeric check (page_confidence between 0 and 1),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (intake_id is not null or document_id is not null or message_id is not null or
         original_sha256 is not null or optimized_sha256 is not null)
);

create table if not exists public.document_ocr_field_audits (
  id uuid primary key default gen_random_uuid(),
  processing_audit_id uuid not null references public.document_processing_audits(id) on delete restrict,
  company_id uuid not null,
  field_name text not null check (length(trim(field_name)) > 0),
  field_path text not null,
  page_number integer not null check (page_number > 0),
  confidence numeric check (confidence between 0 and 1),
  bounding_box jsonb,
  value_before jsonb,
  value_after jsonb,
  change_source text not null default 'ocr' check (change_source in ('ocr','user','system')),
  actor_profile_id uuid,
  correction_reason text,
  created_at timestamptz not null default now()
);

create index if not exists document_processing_audits_lookup_idx
  on public.document_processing_audits(company_id,intake_id,document_id,message_id);
create index if not exists document_processing_audits_original_hash_idx
  on public.document_processing_audits(company_id,original_sha256) where original_sha256 is not null;
create index if not exists document_processing_audits_optimized_hash_idx
  on public.document_processing_audits(company_id,optimized_sha256) where optimized_sha256 is not null;
create index if not exists document_processing_audits_perceptual_hash_idx
  on public.document_processing_audits(company_id,perceptual_hash) where perceptual_hash is not null;
create index if not exists document_ocr_field_audits_export_idx
  on public.document_ocr_field_audits(processing_audit_id,page_number,field_path,created_at);

alter table public.document_processing_audits enable row level security;
alter table public.document_ocr_field_audits enable row level security;

create policy "Company members read document processing audit"
  on public.document_processing_audits for select to authenticated using (
    exists(select 1 from public.company_members member
      where member.company_id=document_processing_audits.company_id and member.profile_id=auth.uid())
  );
create policy "Company members read OCR field audit"
  on public.document_ocr_field_audits for select to authenticated using (
    exists(select 1 from public.company_members member
      where member.company_id=document_ocr_field_audits.company_id and member.profile_id=auth.uid())
  );

-- Audit rows are append-only and emitted by trusted ingestion/review services.
revoke insert,update,delete on public.document_processing_audits from anon,authenticated;
revoke insert,update,delete on public.document_ocr_field_audits from anon,authenticated;
grant select on public.document_processing_audits,public.document_ocr_field_audits to authenticated;

create or replace function public.export_document_ocr_audit(
  target_company_id uuid,
  target_intake_id uuid default null,
  target_document_id uuid default null,
  target_message_id uuid default null,
  target_hash text default null
) returns table(audit_record jsonb)
language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'processing',to_jsonb(processing),
    'fields',coalesce((select jsonb_agg(to_jsonb(field_audit) order by field_audit.page_number,field_audit.field_path,field_audit.created_at)
      from public.document_ocr_field_audits field_audit where field_audit.processing_audit_id=processing.id),'[]'::jsonb)
  )
  from public.document_processing_audits processing
  where processing.company_id=target_company_id
    and (target_intake_id is null or processing.intake_id=target_intake_id)
    and (target_document_id is null or processing.document_id=target_document_id)
    and (target_message_id is null or processing.message_id=target_message_id)
    and (target_hash is null or target_hash in (processing.original_sha256,processing.optimized_sha256,processing.perceptual_hash))
  order by processing.processed_at,processing.page_number;
$$;

revoke all on function public.export_document_ocr_audit(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.export_document_ocr_audit(uuid,uuid,uuid,uuid,text) to authenticated;

update public.system_work_items set
  status='review',progress=85,
  evidence=left(coalesce(evidence||E'\n','')||'DOC-INGEST-010 source: immutable page/file provenance includes dimensions, DPI, orientation, original/optimized/perceptual hashes, quality score/metrics, versioned transform recipe, OCR engine/model/version and page confidence. Field audit retains confidence, location and before/after user corrections. Tenant-scoped lookup/export supports intake, document, message and hash. Contract test added; migration not applied.',4000),
  current_step='Review migration 202608160023, then controlled apply and authenticated cross-tenant/export UAT',
  production_status='Migration 202608160023 not applied; Production unchanged.',
  error_fingerprint=null,updated_at=now()
where work_key='DOC-INGEST-010';

