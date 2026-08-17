-- ATT-REVIEW-UX-001: close the existing work item after production verification.
update public.system_work_items
set status = 'done',
    progress = 100,
    detail = 'Attendance review rows open a complete evidence view with Thai issue labels, employee/site/shift context, GPS accuracy and distance, map link, device and selfie evidence, and permission-aware actions.',
    evidence = 'Attendance repair and soft-delete regression tests, lint, and build passed; Vercel deployment DQtRmFn7LvfsHmVyQxNhck5Jsuoq; /reports returned HTTP 200; production chunk contains review detail, GPS evidence, and Google Maps link.',
    production_status = 'deployed_smoke_passed',
    updated_at = now()
where work_key = 'ATT-REVIEW-UX-001';
