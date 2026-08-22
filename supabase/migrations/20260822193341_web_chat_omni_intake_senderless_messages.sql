-- Web Chat may receive a valid system/guest message before it has a linked
-- profile. It is still Intake evidence and must not disappear from the
-- central registry merely because its sender is unknown.
create or replace function public.omni_register_chat_message_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare room_row record; sender_row record;
begin
  if new.deleted_at is not null then return new; end if;
  select r.name into room_row from public.chat_rooms r
  where r.id = new.room_id and r.company_id = new.company_id limit 1;
  if new.sender_profile_id is not null then
    select coalesce(nullif(trim(p.full_name),''), p.email, p.id::text) as display_name into sender_row
    from public.profiles p where p.id = new.sender_profile_id limit 1;
  end if;
  perform public.omni_register_source(
    new.company_id, 'web_chat', case when new.attachment_path is not null then 'file' else 'message' end,
    null, new.id, new.room_id::text, room_row.name,
    new.sender_profile_id::text, coalesce(sender_row.display_name, 'ไม่ระบุผู้ส่ง'), new.created_at,
    coalesce(new.text_content, new.attachment_name, ''),
    case when new.attachment_path is not null then 1 else 0 end,
    case when new.attachment_path is not null then md5(new.attachment_bucket || ':' || new.attachment_path || ':' || coalesce(new.attachment_size::text,'-')) else null end
  );
  return new;
exception when others then
  raise warning 'omni chat source sync failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

do $$
declare chat_row public.chat_messages; room_name text; sender_name text;
begin
  for chat_row in select * from public.chat_messages where deleted_at is null loop
    select name into room_name from public.chat_rooms where id=chat_row.room_id and company_id=chat_row.company_id limit 1;
    if chat_row.sender_profile_id is not null then
      select coalesce(nullif(trim(full_name),''),email,id::text) into sender_name from public.profiles where id=chat_row.sender_profile_id limit 1;
    else sender_name := 'ไม่ระบุผู้ส่ง'; end if;
    perform public.omni_register_source(
      chat_row.company_id, 'web_chat', case when chat_row.attachment_path is not null then 'file' else 'message' end,
      null, chat_row.id, chat_row.room_id::text, room_name,
      chat_row.sender_profile_id::text, sender_name, chat_row.created_at,
      coalesce(chat_row.text_content,chat_row.attachment_name,''),
      case when chat_row.attachment_path is not null then 1 else 0 end,
      case when chat_row.attachment_path is not null then md5(chat_row.attachment_bucket || ':' || chat_row.attachment_path || ':' || coalesce(chat_row.attachment_size::text,'-')) else null end
    );
  end loop;
end;
$$;

revoke all on function public.omni_register_chat_message_trigger() from public, anon, authenticated;
notify pgrst, 'reload schema';
