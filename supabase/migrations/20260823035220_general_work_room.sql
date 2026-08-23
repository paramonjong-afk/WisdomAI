-- Shared room for ideas and uncategorised work. It classifies and routes
-- messages without becoming the owner of financial, attendance or HR work.

alter table public.chat_rooms add column if not exists room_key text;
alter table public.chat_rooms add column if not exists is_private boolean not null default false;
alter table public.chat_rooms add column if not exists room_purpose text not null default 'business';
alter table public.chat_rooms drop constraint if exists chat_rooms_room_key_check;
alter table public.chat_rooms add constraint chat_rooms_room_key_check
  check (room_key is null or room_key in ('hr_primary','finance_primary','source_room','program_development_primary','general_work_primary'));
create unique index if not exists chat_rooms_company_room_key_unique_general
  on public.chat_rooms(company_id,room_key) where room_key is not null;

alter table public.chat_messages add column if not exists message_class text not null default 'user_message';
alter table public.chat_messages drop constraint if exists chat_messages_message_class_check;
alter table public.chat_messages add constraint chat_messages_message_class_check
  check (message_class in ('user_message','system_confirmation','system_result'));

create table if not exists public.general_work_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_room_id uuid not null references public.chat_rooms(id) on delete cascade,
  source_message_id uuid not null unique references public.chat_messages(id) on delete cascade,
  target_room_id uuid references public.chat_rooms(id) on delete set null,
  target_room_key text,
  intent text not null check (intent in ('development','hr','finance','attendance','general')),
  status text not null default 'classified' check (status in ('classified','forwarded','pending_destination','rejected','failed')),
  recommended_destination text not null,
  forwarded_message_id uuid references public.chat_messages(id) on delete set null,
  error_message text,
  event_key text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists general_work_routes_company_status_idx on public.general_work_routes(company_id,status,updated_at desc);
alter table public.general_work_routes enable row level security;
drop policy if exists "Managers read general work routes" on public.general_work_routes;
create policy "Managers read general work routes" on public.general_work_routes
for select to authenticated using (public.is_company_manager(company_id));
revoke insert,update,delete on public.general_work_routes from anon,authenticated;
grant select on public.general_work_routes to authenticated;

create or replace function public.ensure_standard_general_work_room(target_company_id uuid)
returns public.chat_rooms language plpgsql security definer set search_path=public as $$
declare room_row public.chat_rooms; owner_id uuid;
begin
  if auth.uid() is not null and not public.is_company_manager(target_company_id) then
    raise exception 'general_work_room_manager_required';
  end if;
  select m.profile_id into owner_id
  from public.company_members m join public.profiles p on p.id=m.profile_id
  where m.company_id=target_company_id and m.active and m.company_role='company_admin' and p.role='admin'
  order by m.created_at limit 1;
  if owner_id is null then raise exception 'general_work_room_owner_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company_id::text||':general_work_primary',0));
  select * into room_row from public.chat_rooms where company_id=target_company_id and room_key='general_work_primary' for update;
  if room_row.id is null then
    insert into public.chat_rooms(company_id,name,room_key,is_private,room_purpose,created_by)
    values(target_company_id,'01 | งานทั่วไป','general_work_primary',false,'general_work',owner_id)
    on conflict do nothing;
    select * into room_row from public.chat_rooms where company_id=target_company_id and room_key='general_work_primary' for update;
  else
    update public.chat_rooms set name='01 | งานทั่วไป',is_private=false,room_purpose='general_work',updated_at=now()
    where id=room_row.id returning * into room_row;
  end if;
  -- This is a shared, non-sensitive room. Keep membership company-scoped and
  -- idempotent; role permissions remain governed by chat_room_members RLS.
  insert into public.chat_room_members(room_id,profile_id,member_role)
  select room_row.id,m.profile_id,case when m.profile_id=owner_id then 'owner' else 'member' end
  from public.company_members m where m.company_id=target_company_id and m.active
  on conflict(room_id,profile_id) do update set member_role=excluded.member_role;
  insert into public.program_development_audit(company_id,room_id,event_key,action,actor_profile_id,details)
  values(target_company_id,room_row.id,'general-room-ensure:'||room_row.id::text,'general_room_provisioned',owner_id,
    jsonb_build_object('room_id',room_row.id,'room_key','general_work_primary','creator',owner_id,'created_at',now(),'reason','shared ideas and work triage'))
  on conflict(event_key) do nothing;
  return room_row;
end $$;

create or replace function public.route_general_work_message(target_message_id uuid)
returns public.general_work_routes language plpgsql security definer set search_path=public as $$
declare
  message_row public.chat_messages; room_row public.chat_rooms; route_row public.general_work_routes;
  normalized text; intent_value text; target_key text; target_room_id uuid; target_name text;
  forwarded_id uuid; route_status text; event_value text;
begin
  select * into message_row from public.chat_messages where id=target_message_id;
  select * into room_row from public.chat_rooms where id=message_row.room_id and room_key='general_work_primary';
  if room_row.id is null or message_row.message_class in ('system_confirmation','system_result') then return null; end if;
  if message_row.sender_profile_id is null or not public.is_chat_room_member(room_row.id) then
    return null;
  end if;
  normalized:=lower(coalesce(message_row.text_content,''));
  intent_value:=case
    when normalized ~ '(requirement|bug|บั๊ก|แก้โค้ด|โปรแกรม|ui|หน้าจอ|database|ฐานข้อมูล|api|test|ทดสอบ|build|deploy|พัฒนา)' then 'development'
    when normalized ~ '(ลงเวลา|เข้างาน|ออกงาน|attendance|ot|ลา|พนักงาน|hr|บุคคล)' then 'attendance'
    when normalized ~ '(เบิก|เงินสำรอง|การเงิน|บัญชี|ค่าใช้จ่าย|advance|finance|accounting)' then 'finance'
    else 'general' end;
  target_key:=case intent_value when 'development' then 'program_development_primary' when 'attendance' then 'hr_primary' when 'finance' then 'finance_primary' else 'general_work_primary' end;
  target_name:=case target_key when 'program_development_primary' then '00 | Program Development' when 'hr_primary' then 'HR' when 'finance_primary' then 'การเงิน' else '01 | งานทั่วไป' end;
  event_value:='general-work-route:'||message_row.id::text;
  insert into public.general_work_routes(company_id,source_room_id,source_message_id,target_room_id,target_room_key,intent,status,recommended_destination,event_key,created_by)
  values(room_row.company_id,room_row.id,message_row.id,(select r.id from public.chat_rooms r where r.company_id=room_row.company_id and r.room_key=target_key limit 1),target_key,intent_value,
    case when target_key='general_work_primary' then 'classified' else 'pending_destination' end,target_name,event_value,message_row.sender_profile_id)
  on conflict(source_message_id) do nothing;
  select * into route_row from public.general_work_routes where source_message_id=message_row.id for update;
  if route_row.status in ('forwarded','rejected') then return route_row; end if;
  target_room_id:=route_row.target_room_id;
  if target_room_id is null or target_key='general_work_primary' then return route_row; end if;
  begin
    insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
    values(room_row.company_id,target_room_id,null,'text','ส่งต่อจากห้อง 01 | งานทั่วไป → '||target_name||E'\n\n'||coalesce(message_row.text_content,''),'system_result')
    returning id into forwarded_id;
    update public.general_work_routes set status='forwarded',forwarded_message_id=forwarded_id,updated_at=now() where id=route_row.id returning * into route_row;
  exception when others then
    update public.general_work_routes set status='failed',error_message=left(sqlerrm,1000),updated_at=now() where id=route_row.id returning * into route_row;
  end;
  return route_row;
end $$;

create or replace function public.route_general_work_message_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.route_general_work_message(new.id);
  return new;
exception when others then
  insert into public.program_development_audit(company_id,room_id,source_message_id,event_key,action,actor_profile_id,details)
  values(new.company_id,new.room_id,new.id,'general-work-route-failed:'||new.id::text,'general_route_failed',new.sender_profile_id,jsonb_build_object('error',left(sqlerrm,1000))) on conflict(event_key) do nothing;
  return new;
end $$;
drop trigger if exists route_general_work_message_trigger on public.chat_messages;
create trigger route_general_work_message_trigger after insert on public.chat_messages
for each row execute function public.route_general_work_message_trigger();

revoke all on function public.ensure_standard_general_work_room(uuid),public.route_general_work_message(uuid) from public,anon;
grant execute on function public.ensure_standard_general_work_room(uuid) to authenticated;
notify pgrst,'reload schema';

;
