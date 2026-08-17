-- Ensure one LINE reminder of each type per attendance session.
-- The Edge Function claims this row before sending, so the five-minute cron is safe.

with ranked as (
  select id,
    row_number() over (
      partition by session_id,event_type
      order by created_at,id
    ) as duplicate_number
  from public.attendance_reminder_events
)
delete from public.attendance_reminder_events event
using ranked
where event.id=ranked.id and ranked.duplicate_number>1;

create unique index if not exists attendance_reminder_events_session_type_uidx
  on public.attendance_reminder_events(session_id,event_type);

comment on index public.attendance_reminder_events_session_type_uidx is
  'Prevents the five-minute attendance monitor from sending the same LINE event more than once.';
