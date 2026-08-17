update public.system_work_items
set status='done',progress=100,
    detail='Telegram Admin receives tenant-scoped attendance review cards and can approve, reject or request more information through idempotent callbacks with audit.',
    evidence='Migration 202608110012; approval/fallback regression, Deno check, lint and build passed; telegram-admin and /approvals deployed; anonymous smoke 401; Production Telegram UAT rejected session 863c9746-c0a8-4dfb-8097-ec807b0fe9c5 and bot confirmed status rejected.',
    production_status='deployed_uat_passed',updated_at=now()
where work_key='ATT-TELEGRAM-APPROVAL-001';
