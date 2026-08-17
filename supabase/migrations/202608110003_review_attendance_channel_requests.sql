-- ATT-CHANNEL-001: pause for authenticated cross-channel production UAT.
update public.system_work_items
set status='review',
    progress=90,
    detail='Unified Web/LINE/Telegram attendance intake is deployed. Awaiting authenticated Web and Telegram UAT before completion.',
    evidence='Migration 202608110002 applied; attendance channel regression, lint, and build passed; attendance-clock and telegram-admin deployed; anonymous production smoke returned HTTP 401 for both functions.',
    production_status='deployed_pending_authenticated_channel_uat',
    updated_at=now()
where work_key='ATT-CHANNEL-001';
