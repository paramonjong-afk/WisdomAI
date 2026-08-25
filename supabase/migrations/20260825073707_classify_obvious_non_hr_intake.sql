-- HR-INTAKE-NON-HR-001
-- Deterministic, high-confidence exclusion for development/UAT messages.

create or replace function public.capture_hr_intake_raw_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare raw_item public.hr_intake_raw_items; initial_status text; initial_reason text;
begin
  initial_status:=case
    when new.sender_profile_id is null or new.message_class in ('system_confirmation','system_result') then 'context'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'context'
    when coalesce(new.text_content,'') ~* '(^|[^[:alnum:]_])(bug|uat|deploy|build|database|api)([^[:alnum:]_]|$)'
      and coalesce(new.text_content,'') !~* '(ลงเวลา|เข้างาน|ออกงาน|ลา|พนักงาน|ช่าง|ค่าแรง|hr)' then 'not_hr'
    else 'pending'
  end;
  initial_reason:=case
    when new.sender_profile_id is null then 'system_sender_context_only'
    when new.message_class in ('system_confirmation','system_result') then 'system_message_context_only'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'daily_summary_context_only'
    when initial_status='not_hr' then 'development_message_not_hr'
    else 'awaiting_hr_intake_classification'
  end;
  insert into public.hr_intake_raw_items(
    company_id,raw_message_id,source_channel,source_ref,room_id,sender_profile_id,status,content_snapshot,classification_reason,
    confidence,classified_at
  ) values(
    new.company_id,new.id,'web_chat',new.id::text,new.room_id,new.sender_profile_id,initial_status,new.text_content,initial_reason,
    case when initial_status in ('context','not_hr') then 1 else null end,
    case when initial_status in ('context','not_hr') then now() else null end
  ) on conflict(company_id,source_channel,source_ref) do nothing returning * into raw_item;
  if raw_item.id is not null then
    insert into public.hr_intake_events(company_id,raw_item_id,event_type,from_status,to_status,reason,details)
    values(new.company_id,raw_item.id,'raw_received',null,initial_status,initial_reason,
      jsonb_build_object('message_class',new.message_class,'room_id',new.room_id,'sender_profile_id',new.sender_profile_id));
  end if;
  return new;
end $$;

with candidates as (
  select raw.id,raw.company_id
  from public.hr_intake_raw_items raw
  join public.chat_messages message on message.id=raw.raw_message_id and message.company_id=raw.company_id
  where raw.status='pending'
    and coalesce(message.text_content,'') ~* '(^|[^[:alnum:]_])(bug|uat|deploy|build|database|api)([^[:alnum:]_]|$)'
    and coalesce(message.text_content,'') !~* '(ลงเวลา|เข้างาน|ออกงาน|ลา|พนักงาน|ช่าง|ค่าแรง|hr)'
), updated as (
  update public.hr_intake_raw_items raw set status='not_hr',classification_reason='development_message_not_hr',
    confidence=1,classified_at=coalesce(raw.classified_at,now()),updated_at=now()
  from candidates candidate where raw.id=candidate.id
  returning raw.id,raw.company_id
)
insert into public.hr_intake_events(company_id,raw_item_id,event_type,from_status,to_status,action_key,reason,details)
select company_id,id,'intake_reconciled','pending','not_hr','non-hr-reconcile:'||id,
  'development_message_not_hr',jsonb_build_object('rule','deterministic_development_keyword','reconciled_at',now())
from updated
on conflict do nothing;

revoke all on function public.capture_hr_intake_raw_message() from public,anon,authenticated;
notify pgrst, 'reload schema';
