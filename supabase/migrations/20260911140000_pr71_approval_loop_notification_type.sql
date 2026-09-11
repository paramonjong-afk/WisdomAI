-- Fix for a real bug flagged by Codex's own review bot on PR #71
-- (https://github.com/paramonjong-afk/WisdomAI/pull/71), not yet addressed.
--
-- ROOT CAUSE: health_monitor_notifications.notification_type is defined in
-- 202608030004_health_monitor.sql (line 60) with:
--   check(notification_type in ('incident','recovery','repeat','daily_summary','configuration'))
-- PR #71 adds code that inserts notification_type='approval_loop_detected'
-- (supabase/functions/health-monitor/index.ts, recordAdminNotification call
-- in the escalations loop) but never extends this constraint. Every such
-- insert is rejected by Postgres; the insert error is swallowed after the
-- Telegram message already went out, so:
--   (a) no audit/dedup row is ever recorded for a detected approval loop, and
--   (b) because there is no dedup row, every scheduled health-monitor run
--       can re-send the same "approval loop detected" Telegram alert --
--       exactly the repeat-notification spam this PR is meant to prevent.
--
-- FIX: extend the CHECK constraint to allow 'approval_loop_detected'. Safe,
-- additive, no data migration needed (existing rows already satisfy a wider
-- allow-list). Must go through PR -> CI -> merge like any other migration;
-- do not apply directly against production.

alter table public.health_monitor_notifications
  drop constraint if exists health_monitor_notifications_notification_type_check;

alter table public.health_monitor_notifications
  add constraint health_monitor_notifications_notification_type_check
  check (notification_type in (
    'incident','recovery','repeat','daily_summary','configuration',
    'approval_loop_detected'
  ));
