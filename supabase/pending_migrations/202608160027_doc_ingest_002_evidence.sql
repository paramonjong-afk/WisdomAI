-- Pending evidence update for DOC-INGEST-002; excluded from the approved 021-026 deployment.
update public.system_work_items
set status='review',
    progress=75,
    production_status='source_verified_not_deployed',
    current_step='ผูก native image processor และ benchmark OCR corpus ภาพจริงก่อน-หลัง',
    evidence=left(coalesce(evidence||E'\n','')||'DOC-INGEST-002 source: src/utils/imageQualityPolicy.ts; test: scripts/image-quality-policy.test.ts. Profiles cover accounting 2500px/Q92-95, handwriting 2800px/Q95, system error 2000px/Q88-90, general 1600px/Q78-82 and thumbnail 480-640px/Q70-80. Versioned recipe requires auto-orient, EXIF/GPS stripping, deskew, white balance, shadow removal, denoise and text sharpening. Quality gate checks blur/glare/crop/finger/missing page and routes to human review if any amount/date/tax ID/document number OCR score regresses. Source-only; migration not applied and production not deployed.',4000),
    error_fingerprint=null,
    updated_at=now()
where work_key='DOC-INGEST-002';
