-- HR-INTAKE-RECONCILE-001
-- System-generated attendance notifications are context, not new HR work.
-- Reconcile legacy pending raw rows and legacy approval jobs without deleting
-- source messages, attendance, raw evidence, or audit history.

create or replace function public.capture_hr_intake_raw_message()
returns trigger language plpgsql security definer set search_path=public as $$
declare raw_item public.hr_intake_raw_items; initial_status text; initial_reason text;
begin
  initial_status:=case
    when new.sender_profile_id is null or new.message_class in ('system_confirmation','system_result') then 'context'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'context'
    else 'pending'
  end;
  initial_reason:=case
    when new.sender_profile_id is null then 'system_sender_context_only'
    when new.message_class in ('system_confirmation','system_result') then 'system_message_context_only'
    when coalesce(new.text_content,'') ilike '%สรุปสถานะงาน HR ประจำวัน%' then 'daily_summary_context_only'
    else 'awaiting_hr_intake_classification'
  end;
  insert into public.hr_intake_raw_items(
    company_id,raw_message_id,source_channel,source_ref,room_id,sender_profile_id,status,content_snapshot,classification_reason,
    classified_at
  ) values(
    new.company_id,new.id,'web_chat',new.id::text,new.room_id,new.sender_profile_id,initial_status,new.text_content,initial_reason,
    case when initial_status='context' then now() else null end
  ) on conflict(company_id,source_channel,source_ref) do nothing returning * into raw_item;
  if raw_item.id is not null then
    insert into public.hr_intake_events(company_id,raw_item_id,event_type,from_status,to_status,reason,details)
    values(new.company_id,raw_item.id,'raw_received',null,initial_status,initial_reason,
      jsonb_build_object('message_class',new.message_class,'room_id',new.room_id,'sender_profile_id',new.sender_profile_id));
  end if;
  return new;
end $$;

create or replace function public.omni_register_chat_message_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_row record; sender_row record;
begin
  if new.deleted_at is not null or new.sender_profile_id is null
     or new.message_class in ('system_confirmation','system_result') then return new; end if;
  select r.name into room_row from public.chat_rooms r where r.id=new.room_id and r.company_id=new.company_id limit 1;
  select coalesce(nullif(trim(p.full_name),''),p.email,p.id::text) as display_name
    into sender_row from public.profiles p where p.id=new.sender_profile_id limit 1;
  perform public.omni_register_source(new.company_id,'web_chat',
    case when new.attachment_path is not null then 'file' else 'message' end,
    null,new.id,new.room_id::text,room_row.name,new.sender_profile_id::text,
    coalesce(sender_row.display_name,'ไม่ระบุผู้ส่ง'),new.created_at,
    coalesce(new.text_content,new.attachment_name,''),
    case when new.attachment_path is not null then 1 else 0 end,
    case when new.attachment_path is not null then md5(new.attachment_bucket||':'||new.attachment_path||':'||coalesce(new.attachment_size::text,'-')) else null end);
  return new;
exception when others then
  raise warning 'omni chat source sync failed for %: %',new.id,sqlerrm;
  return new;
end $$;

do $$
declare row_value record; old_status text;
begin
  for row_value in
    select raw.id,raw.company_id,raw.status,message.message_class,message.sender_profile_id
    from public.hr_intake_raw_items raw
    join public.chat_messages message on message.id=raw.raw_message_id and message.company_id=raw.company_id
    where raw.status='pending'
      and (message.sender_profile_id is null or message.message_class in ('system_confirmation','system_result'))
    for update of raw
  loop
    old_status:=row_value.status;
    update public.hr_intake_raw_items set status='context',
      classification_reason=case when row_value.sender_profile_id is null then 'system_sender_context_only' else 'system_message_context_only' end,
      confidence=1,classified_at=coalesce(classified_at,now()),updated_at=now()
    where id=row_value.id;
    insert into public.hr_intake_events(company_id,raw_item_id,event_type,from_status,to_status,action_key,reason,details)
    values(row_value.company_id,row_value.id,'intake_reconciled',old_status,'context',
      'system-context-reconcile:'||row_value.id,
      case when row_value.sender_profile_id is null then 'system_sender_context_only' else 'system_message_context_only' end,
      jsonb_build_object('message_class',row_value.message_class,'reconciled_at',now()))
    on conflict do nothing;
  end loop;

  -- The bundle trigger did not exist for jobs created before the bundle migration.
  -- Sync only missing links; unique constraints keep this replay idempotent.
  for row_value in
    select job.id from public.chat_attendance_approval_jobs job
    where not exists (
      select 1 from public.hr_confirmation_bundle_items item
      where item.attendance_job_id=job.id
    )
    order by job.created_at
  loop
    perform public.sync_hr_confirmation_bundle_for_job(row_value.id);
  end loop;
end $$;

revoke all on function public.capture_hr_intake_raw_message() from public,anon,authenticated;
revoke all on function public.omni_register_chat_message_trigger() from public,anon,authenticated;
notify pgrst, 'reload schema';
