-- ATT-CHANNEL-001: close after Telegram production UAT confirmed safe incomplete intake.
update public.system_work_items
set status='done',
    progress=100,
    detail='Unified tenant-safe Web, LINE, and Telegram attendance intake is deployed. Incomplete Telegram requests are retained for review without creating attendance sessions.',
    evidence='Migration 202608110002; attendance channel regression, lint and build passed; attendance-clock and telegram-admin deployed; anonymous security smoke returned 401; Telegram /clockin UAT returned request a117edb8-8842-4b19-9d14-a737227966ed with location/selfie required and explicit no-attendance-created confirmation.',
    production_status='deployed_uat_passed',
    updated_at=now()
where work_key='ATT-CHANNEL-001';
