-- Fix PL/pgSQL variable/column ambiguity in room membership inserts.
create or replace function public.ensure_advance_confirmation_room(
  target_company_id uuid,
  target_room_key text,
  target_source_room_id uuid default null,
  target_source_room_name text default null,
  target_source_profile_id uuid default null,
  target_advance_case_id uuid default null,
  target_event_key text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  resolved_room_id uuid; creator_id uuid; room_name text; integration_key_value text; reason_value text;
begin
  if target_room_key not in ('hr_primary','finance_primary','source_room') then raise exception 'advance_confirmation_room_key_invalid'; end if;
  if target_company_id is null or target_advance_case_id is null or nullif(trim(target_event_key),'') is null then raise exception 'advance_confirmation_room_context_required'; end if;
  if auth.uid() is not null and not public.is_company_manager(target_company_id) then raise exception 'advance_confirmation_manager_required'; end if;
  if target_room_key='source_room' and (target_source_room_id is null or nullif(trim(target_source_room_name),'') is null or lower(target_source_room_name) similar to '%(00|codex)%') then raise exception 'advance_confirmation_source_room_context_unverified'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company_id::text||':'||target_room_key,0));
  room_name := case target_room_key when 'hr_primary' then 'HR' when 'finance_primary' then 'การเงิน' else btrim(target_source_room_name) end;
  integration_key_value := case target_room_key when 'hr_primary' then 'attendance' when 'finance_primary' then 'advance_confirmation' else null end;
  reason_value := case target_room_key when 'hr_primary' then 'Program Loop ต้องมีห้อง HR หลัก' when 'finance_primary' then 'Program Loop ต้องมีห้องเงินสำรองจ่าย/การเงินหลัก' else 'Program Loop ยืนยัน source context จาก Document Flow' end;
  if target_room_key='source_room' then
    select r.id into resolved_room_id from public.chat_rooms r where r.id=target_source_room_id and r.company_id=target_company_id;
  elsif integration_key_value is not null then
    select i.room_id into resolved_room_id from public.chat_room_integrations i where i.company_id=target_company_id and i.integration_key=integration_key_value and i.enabled limit 1;
  end if;
  if resolved_room_id is null then select r.id into resolved_room_id from public.chat_rooms r where r.company_id=target_company_id and r.room_key=target_room_key limit 1; end if;
  if resolved_room_id is null then select r.id into resolved_room_id from public.chat_rooms r where r.company_id=target_company_id and lower(r.name)=lower(room_name) limit 1; end if;
  creator_id := coalesce(auth.uid(),(select m.profile_id from public.company_members m where m.company_id=target_company_id and m.active and m.company_role in ('company_admin','executive','manager') order by case m.company_role when 'company_admin' then 1 when 'executive' then 2 else 3 end,m.created_at limit 1));
  if creator_id is null then raise exception 'advance_confirmation_room_creator_not_found'; end if;
  if resolved_room_id is null then
    insert into public.chat_rooms(company_id,name,room_key,created_by) values(target_company_id,room_name,target_room_key,creator_id) returning id into resolved_room_id;
  else
    update public.chat_rooms set room_key=coalesce(room_key,target_room_key),updated_at=now() where id=resolved_room_id and company_id=target_company_id;
  end if;
  if target_room_key='finance_primary' then
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select resolved_room_id,m.profile_id,case when m.company_role='company_admin' then 'owner' else 'member' end
    from public.company_members m where m.company_id=target_company_id and m.active and m.company_role in ('company_admin','executive','manager')
    on conflict(room_id,profile_id) do nothing;
  elsif target_room_key='hr_primary' then
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select resolved_room_id,m.profile_id,case when m.company_role='company_admin' then 'owner' else 'member' end
    from public.company_members m where m.company_id=target_company_id and m.active and m.company_role in ('accounting_hr','company_admin','executive','manager','site_supervisor')
    on conflict(room_id,profile_id) do nothing;
  elsif target_source_room_id is not null then
    if not exists(select 1 from public.chat_room_members where room_id=target_source_room_id) then raise exception 'advance_confirmation_source_room_members_unverified'; end if;
    insert into public.chat_room_members(room_id,profile_id,member_role)
    select resolved_room_id,m.profile_id,m.member_role from public.chat_room_members m where m.room_id=target_source_room_id
    on conflict(room_id,profile_id) do nothing;
    if target_source_profile_id is not null then
      insert into public.chat_room_members(room_id,profile_id,member_role) values(resolved_room_id,target_source_profile_id,'member') on conflict(room_id,profile_id) do nothing;
    end if;
  end if;
  if target_room_key='source_room' and not exists(select 1 from public.chat_room_members m where m.room_id=resolved_room_id) then raise exception 'advance_confirmation_source_room_members_unverified'; end if;
  if integration_key_value is not null then
    insert into public.chat_room_integrations(company_id,integration_key,room_id,enabled,created_by)
    values(target_company_id,integration_key_value,resolved_room_id,true,creator_id)
    on conflict(company_id,integration_key) do update set room_id=excluded.room_id,enabled=true,updated_at=now();
  end if;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,after_data,reason)
  values(target_advance_case_id,target_company_id,'advance-room-setup:'||target_event_key||':'||target_room_key,'confirmation_room_setup',creator_id,jsonb_build_object('room_id',resolved_room_id,'room_key',target_room_key,'creator_id',creator_id,'created_at',now(),'advance_id',target_advance_case_id,'event_key',target_event_key),reason_value)
  on conflict(event_key) do nothing;
  return resolved_room_id;
end $$;
notify pgrst,'reload schema';

;


revoke execute on function public.ensure_advance_confirmation_room(uuid,text,uuid,text,uuid,uuid,text) from public, anon;
grant execute on function public.ensure_advance_confirmation_room(uuid,text,uuid,text,uuid,uuid,text) to authenticated, service_role;
;

