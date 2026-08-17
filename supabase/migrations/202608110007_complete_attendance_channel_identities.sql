-- ATT-IDENTITY-001: close after authenticated Telegram identity UAT passed.
update public.system_work_items
set status='done',
    progress=100,
    detail='Tenant-scoped LINE/Telegram employee identity registry is deployed. Unverified identities cannot create real attendance sessions.',
    evidence='Migration 202608110005; identity and channel isolation tests, lint and build passed; telegram-admin deployed; anonymous smoke returned HTTP 401; authenticated Telegram /clockin UAT created request 40884ae0-3c59-4eb8-ba16-ae819d1a033c and correctly required Location/Selfie without creating attendance.',
    production_status='deployed_uat_passed',
    updated_at=now()
where work_key='ATT-IDENTITY-001';
