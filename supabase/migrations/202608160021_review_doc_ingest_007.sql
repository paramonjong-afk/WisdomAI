-- Evidence-only reconciliation for the existing DOC-INGEST-007 work item.
-- This does not create a second task or alter schema/security. Apply only through
-- the normal reviewed deployment process; it is intentionally not run locally.
update public.system_work_items
set status = 'review',
    progress = greatest(progress, 80),
    production_status = 'not_deployed',
    evidence = left(concat_ws(E'\n', nullif(evidence, ''),
      'Source: src/utils/documentPipeline.ts; corpus: scripts/document-pipeline.test.ts (native/scan/multipage/signed/password PDF, HEIC/TIFF, lossless WebP policy, page mapping) passed; build passed; focused lint passed. Full lint remains blocked by pre-existing AccountingDocuments errors. No migration or production deployment was run.'), 4000),
    current_step = 'Review production converter adapters and run signed/password/HEIC/TIFF binary corpus smoke test before deployment',
    updated_at = now()
where work_key = 'DOC-INGEST-007';
