begin;

alter table public.health_monitor_notifications
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.health_monitor_notifications notification
set company_id=chat.company_id
from public.telegram_admin_chats chat
where notification.company_id is null
  and notification.destination='telegram:'||chat.telegram_chat_id;

create index if not exists health_monitor_notifications_company_created_idx
  on public.health_monitor_notifications(company_id,created_at desc);

drop policy if exists "Managers read health notifications" on public.health_monitor_notifications;
drop policy if exists "Authorized users read health notifications" on public.health_monitor_notifications;
create policy "Authorized users read health notifications"
on public.health_monitor_notifications for select to authenticated using(
  (company_id is not null and public.is_company_manager(company_id))
  or (company_id is null and exists(select 1 from public.profiles profile where profile.id=auth.uid() and profile.role='admin'))
);

create or replace view public.communication_event_feed
with (security_invoker=true)
as
select
  'health:'||notification.id::text as event_id,
  notification.company_id,
  notification.created_at as occurred_at,
  case when notification.destination like 'telegram:%' then 'telegram'
       when notification.destination like 'line:%' then 'line'
       else 'system' end as channel,
  notification.notification_type as event_type,
  notification.status,
  notification.notification_type as title,
  notification.message,
  notification.destination,
  'health_monitor_notification' as source_type,
  notification.id::text as source_id,
  null::uuid as actor_profile_id,
  null::uuid as related_profile_id,
  null::text as related_work_key,
  notification.error_message,
  null::timestamptz as responded_at
from public.health_monitor_notifications notification
union all
select
  'line:'||event.id::text,
  event.company_id,
  event.received_at,
  'line',
  event.event_type,
  event.processing_status,
  coalesce(event.output_type,event.message_type,event.event_type),
  concat_ws(' · ',event.processing_stage,nullif(event.error_message,'')),
  coalesce(event.line_group_id,event.line_user_id),
  'line_ingestion_event',
  event.id::text,
  null::uuid,
  null::uuid,
  null::text,
  event.error_message,
  event.processed_at
from public.line_ingestion_events event
union all
select
  'telegram:'||event.id::text,
  event.company_id,
  event.created_at,
  'telegram',
  event.event_type,
  event.status,
  coalesce(nullif(event.command,''),event.event_type),
  event.command,
  event.telegram_chat_id,
  'telegram_admin_event',
  event.id::text,
  account.profile_id,
  null::uuid,
  null::text,
  event.error_message,
  event.processed_at
from public.telegram_admin_events event
left join public.telegram_admin_accounts account
  on account.company_id=event.company_id and account.telegram_user_id=event.telegram_user_id and account.active
union all
select
  'attendance-approval:'||event.id::text,
  event.company_id,
  event.created_at,
  case when event.source='line_group' then 'line' else 'web' end,
  'attendance_'||event.action,
  event.new_status,
  'อนุมัติรายการลงเวลา',
  event.reason,
  event.line_group_id,
  'attendance_approval_event',
  event.id::text,
  event.actor_profile_id,
  session.profile_id,
  null::text,
  null::text,
  event.created_at
from public.attendance_approval_events event
join public.attendance_sessions session on session.id=event.session_id and session.company_id=event.company_id
union all
select
  'work:'||event.id::text,
  event.company_id,
  event.created_at,
  'system',
  event.event_type,
  coalesce(event.new_status,event.old_status,event.event_type),
  event.work_key,
  event.note,
  null::text,
  'system_work_item_event',
  event.id::text,
  event.actor_id,
  null::uuid,
  event.work_key,
  null::text,
  event.created_at
from public.system_work_item_events event;

revoke all on public.communication_event_feed from anon;
grant select on public.communication_event_feed to authenticated;

comment on view public.communication_event_feed is
  'Permission-aware communication and workflow timeline. The view uses source-table RLS and does not duplicate message content.';

commit;
