-- Pending evidence update for DOC-INGEST-012; excluded from the approved 021-026 deployment.
-- No schema/security change. Apply only through the reviewed deployment process;
-- this migration is intentionally not run locally.
update public.system_work_items
set status='review',
    progress=greatest(progress,75),
    production_status='not_deployed',
    evidence=left(concat_ws(E'\n',nullif(evidence,''),
      'DOC-INGEST-012 source: src/utils/localFirstAiRouter.ts; benchmark: scripts/local-first-ai-router.test.ts. Local routing selects OpenCV/ImageMagick preprocessing, PaddleOCR PP-OCRv5 Thai, PDF.js native text/Poppler scan rendering and PP-Structure tables. Rules validate Thai tax ID checksum, bounded Gregorian/Buddhist dates, finite non-negative amounts, VAT, totals and line equations. Cloud fallback requires low effective confidence, explicit consent, a finite cost estimate and sufficient non-negative budget; every decision records reason and chargeable estimated cost. Four synthetic benchmark groups (printed Thai/handwriting/table/PDF), malformed numeric edge cases and cloud-usage policy passed; focused ESLint and build passed. Full lint is blocked by four pre-existing errors in AccountingDocuments and DocumentFlows outside this focused change. Source-only: production engine adapters and a representative Thai binary corpus still require review; no migration, cloud call or production deployment was run.'),4000),
    current_step='Review production engine adapters and run a representative Thai binary corpus before deployment',
    updated_at=now()
where work_key='DOC-INGEST-012';
