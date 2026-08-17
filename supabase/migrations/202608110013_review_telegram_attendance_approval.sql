update public.system_work_items
set status='review',progress=90,
    detail='Telegram Admin receives tenant-scoped attendance review cards and can approve, reject or request more information through idempotent callbacks with audit.',
    evidence='Migration 202608110012 applied; approval/fallback regression, Deno check, lint and build passed; telegram-admin deployed; anonymous production smoke returned HTTP 401.',
    production_status='deployed_pending_button_uat',updated_at=now()
where work_key='ATT-TELEGRAM-APPROVAL-001';
