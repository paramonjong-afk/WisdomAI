-- ATT-IDENTITY-001: deployed safely; pause for authenticated Telegram identity UAT.
update public.system_work_items
set status='review',
    progress=90,
    detail='Tenant-scoped LINE/Telegram employee identity registry is deployed. Awaiting authenticated Telegram /clockin UAT before completion.',
    evidence='Migration 202608110005 applied; attendance channel and identity isolation tests, lint, and build passed; telegram-admin deployed; anonymous production smoke returned HTTP 401.',
    production_status='deployed_pending_authenticated_identity_uat',
    updated_at=now()
where work_key='ATT-IDENTITY-001';
