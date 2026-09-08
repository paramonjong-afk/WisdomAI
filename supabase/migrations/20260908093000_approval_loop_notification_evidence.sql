begin;

-- Health Monitor already writes these notification kinds. The original
-- constraint pre-dated work-item monitoring, so inserts could fail and leave
-- no durable evidence.
alter table public.health_monitor_notifications
  add column if not exists dedupe_key text;

alter table public.health_monitor_notifications
  drop constraint if exists health_monitor_notifications_notification_type_check;

alter table public.health_monitor_notifications
  add constraint health_monitor_notifications_notification_type_check
  check (notification_type in (
    'incident', 'recovery', 'repeat', 'daily_summary', 'configuration',
    'work_approval_requested', 'work_escalation_alert', 'approval_loop_detected'
  ));

-- One monitor run may fan out to several Telegram rooms. Include destination
-- so the same evidence is delivered once per room, even under concurrent runs.
create unique index if not exists health_monitor_notification_dedupe_idx
  on public.health_monitor_notifications(notification_type, destination, dedupe_key)
  where dedupe_key is not null;

-- Keep one append-only audit event for each detected loop fingerprint without
-- changing the work item's business status or approval decision.
create unique index if not exists system_work_item_approval_loop_evidence_idx
  on public.system_work_item_events(work_key, event_type, (md5(coalesce(note, ''))))
  where event_type = 'approval_loop_detected';

commit;
