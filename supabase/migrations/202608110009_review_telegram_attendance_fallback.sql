-- ATT-FALLBACK-001: deployed; await real Telegram GPS + selfie UAT.
update public.system_work_items
set status='review',progress=90,
    detail='Telegram fallback now receives a short-lived GPS and selfie sequence, selects a tenant-safe site, stores evidence privately, and atomically records or routes attendance for review.',
    evidence='Migration 202608110008 applied; fallback regression, Deno check, lint and build passed; telegram-admin deployed; anonymous production smoke returned HTTP 401.',
    production_status='deployed_pending_gps_selfie_uat',updated_at=now()
where work_key='ATT-FALLBACK-001';
