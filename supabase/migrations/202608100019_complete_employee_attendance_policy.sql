-- EMP-POLICY-001: record the verified production completion in the source-of-truth queue.
update public.system_work_items
set status = 'done',
    progress = 100,
    detail = 'Attendance policy, explainable time, employee drill-down, current-period payroll context, and realtime project-cost refresh are deployed.',
    evidence = 'Migration 202608100018; employee attendance policy regression, lint, and build passed; Vercel deployment ChhYnpdWK7vhUiYksKLBVWxPR8yx; /reports and / returned HTTP 200; production chunks contain daily missing-time calendar and project-cost-live realtime channel.',
    production_status = 'deployed_smoke_passed',
    updated_at = now()
where work_key = 'EMP-POLICY-001';
