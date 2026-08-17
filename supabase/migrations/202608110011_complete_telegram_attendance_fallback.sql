-- ATT-FALLBACK-001: close after real Telegram GPS + selfie UAT.
update public.system_work_items
set status='done',progress=100,
    detail='Telegram attendance fallback receives identity, GPS and selfie evidence, stores tenant-safe media, calculates site distance, and atomically records normal attendance or routes exceptions for review.',
    evidence='Migration 202608110008 and Storage policy deployed; regression, Deno check, lint and build passed; anonymous smoke 401; Telegram group Reply hotfix deployed; production UAT request 22a2a91d-cec8-495a-acf7-e29a41e22b9f received GPS/Selfie, calculated 143995 metres and correctly routed the out-of-site attendance to pending review.',
    production_status='deployed_uat_passed',updated_at=now()
where work_key='ATT-FALLBACK-001';
