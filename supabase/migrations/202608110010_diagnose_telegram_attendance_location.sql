-- ATT-FALLBACK-001 diagnostic: expose only the latest processing error in migration output/audit.
do $$
declare latest_error text;
begin
  select error_message into latest_error
  from public.telegram_admin_events
  where event_type in ('location','photo') and status='failed'
  order by created_at desc limit 1;
  raise notice 'ATT_FALLBACK_LATEST_ERROR=%',coalesce(latest_error,'none');
  update public.system_work_items
  set evidence=left(concat_ws(E'\n',nullif(evidence,''),'Production UAT: Telegram GPS received no bot response; latest processing error captured in migration audit.'),4000),updated_at=now()
  where work_key='ATT-FALLBACK-001';
end $$;
