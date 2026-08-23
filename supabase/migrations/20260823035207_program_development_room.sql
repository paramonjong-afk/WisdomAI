-- Private owner-only Web Chat room for development commands.
-- Business Program Loop messages never target this room.

alter table public.chat_rooms
  add column if not exists room_key text;
alter table public.chat_rooms
  add column if not exists is_private boolean not null default false,
  add column if not exists room_purpose text not null default 'business';
alter table public.chat_rooms drop constraint if exists chat_rooms_room_key_check;
alter table public.chat_rooms add constraint chat_rooms_room_key_check
  check (room_key is null or room_key in ('hr_primary','finance_primary','source_room','program_development_primary','general_work_primary'));
create unique index if not exists chat_rooms_company_room_key_unique_program_development
  on public.chat_rooms(company_id,room_key) where room_key is not null;

alter table public.chat_messages
  add column if not exists message_class text not null default 'user_message';
alter table public.chat_messages drop constraint if exists chat_messages_message_class_check;
alter table public.chat_messages add constraint chat_messages_message_class_check
  check (message_class in ('user_message','system_confirmation','system_result'));

create table if not exists public.development_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete restrict,
  source_message_id uuid not null unique references public.chat_messages(id) on delete restrict,
  event_key text not null unique,
  task_code text not null,
  request_text text not null,
  intent text not null check (intent in ('requirement','bug','ui','flow','database','api','test','build','deploy')),
  status text not null default 'received' check (status in ('received','in_progress','waiting_review','completed','blocked')),
  owner_profile_id uuid not null references public.profiles(id) on delete restrict,
  result_summary text,
  files jsonb not null default '[]'::jsonb,
  commit_ref text,
  test_result text,
  build_result text,
  deploy_result text,
  blocker text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,task_code)
);
create index if not exists development_tasks_status_idx on public.development_tasks(company_id,status,updated_at desc);

create table if not exists public.development_task_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid not null references public.development_tasks(id) on delete cascade,
  target text not null default 'codex' check (target in ('codex','developer_queue')),
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  retry_count integer not null default 0 check (retry_count >= 0),
  event_key text not null unique,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id,target)
);

create table if not exists public.program_development_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  task_id uuid references public.development_tasks(id) on delete set null,
  room_id uuid references public.chat_rooms(id) on delete set null,
  source_message_id uuid references public.chat_messages(id) on delete set null,
  event_key text not null unique,
  action text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.development_tasks enable row level security;
alter table public.development_task_dispatches enable row level security;
alter table public.program_development_audit enable row level security;
create or replace function public.is_program_development_owner(target_company_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.company_members m join public.profiles p on p.id=m.profile_id
    where m.company_id=target_company_id and m.profile_id=auth.uid() and m.active
      and m.company_role='company_admin' and p.role='admin'
  );
$$;
drop policy if exists "Development owner reads tasks" on public.development_tasks;
create policy "Development owner reads tasks" on public.development_tasks for select to authenticated
using (public.is_program_development_owner(company_id));
drop policy if exists "Development owner reads dispatches" on public.development_task_dispatches;
create policy "Development owner reads dispatches" on public.development_task_dispatches for select to authenticated
using (public.is_program_development_owner(company_id));
drop policy if exists "Development owner reads audit" on public.program_development_audit;
create policy "Development owner reads audit" on public.program_development_audit for select to authenticated
using (public.is_program_development_owner(company_id));
revoke insert,update,delete on public.development_tasks,public.development_task_dispatches,public.program_development_audit from anon,authenticated;
grant select on public.development_tasks,public.development_task_dispatches,public.program_development_audit to authenticated;

drop policy if exists "Members read their chat rooms" on public.chat_rooms;
create policy "Members read their chat rooms" on public.chat_rooms
for select to authenticated using (
  company_id = public.current_company_id() and (
    public.is_chat_room_member(id)
    or (not is_private and public.is_company_manager(company_id))
  )
);

create or replace function public.ensure_standard_program_development_room(target_company_id uuid)
returns public.chat_rooms language plpgsql security definer set search_path=public as $$
declare owner_id uuid; room_row public.chat_rooms;
begin
  if auth.uid() is not null and not public.is_program_development_owner(target_company_id) then
    raise exception 'program_development_owner_required';
  end if;
  select m.profile_id into owner_id from public.company_members m join public.profiles p on p.id=m.profile_id
  where m.company_id=target_company_id and m.active and m.company_role='company_admin' and p.role='admin'
  order by m.created_at limit 1;
  if owner_id is null then raise exception 'program_development_owner_not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_company_id::text||':program_development_primary',0));
  select * into room_row from public.chat_rooms where company_id=target_company_id and room_key='program_development_primary' for update;
  if room_row.id is null then
    insert into public.chat_rooms(company_id,name,room_key,is_private,room_purpose,created_by)
    values(target_company_id,'00 | Program Development','program_development_primary',true,'program_development',owner_id)
    on conflict do nothing;
    select * into room_row from public.chat_rooms where company_id=target_company_id and room_key='program_development_primary' for update;
  else
    update public.chat_rooms set name='00 | Program Development',is_private=true,room_purpose='program_development',updated_at=now()
    where id=room_row.id returning * into room_row;
  end if;
  -- The owner membership is the minimum required to open a private room; no
  -- other member is added by this provisioning function.
  insert into public.chat_room_members(room_id,profile_id,member_role)
  values(room_row.id,owner_id,'owner') on conflict(room_id,profile_id) do update set member_role='owner';
  insert into public.program_development_audit(company_id,room_id,event_key,action,actor_profile_id,details)
  values(target_company_id,room_row.id,'program-room-ensure:'||room_row.id::text,'room_provisioned',owner_id,
    jsonb_build_object('room_id',room_row.id,'room_key','program_development_primary','creator',owner_id,'created_at',now(),'reason','owner-only development command room'))
  on conflict(event_key) do nothing;
  return room_row;
end $$;

create or replace function public.protect_program_development_members()
returns trigger language plpgsql security definer set search_path=public as $$
declare room_row public.chat_rooms;
begin
  select * into room_row from public.chat_rooms where id=coalesce(new.room_id,old.room_id);
  if room_row.room_key='program_development_primary' and coalesce(new.profile_id,old.profile_id)<>room_row.created_by then
    raise exception 'program_development_private_owner_only';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists protect_program_development_members_trigger on public.chat_room_members;
create trigger protect_program_development_members_trigger
before insert or update or delete on public.chat_room_members
for each row execute function public.protect_program_development_members();

create or replace function public.protect_program_development_room()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(old.room_key,new.room_key)='program_development_primary'
    and auth.uid() is not null and auth.uid()<>coalesce(old.created_by,new.created_by) then
    raise exception 'program_development_private_owner_only';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists protect_program_development_room_trigger on public.chat_rooms;
create trigger protect_program_development_room_trigger
before update or delete on public.chat_rooms for each row execute function public.protect_program_development_room();

create or replace function public.route_program_development_message(target_message_id uuid)
returns public.development_tasks language plpgsql security definer set search_path=public as $$
declare message_row public.chat_messages; room_row public.chat_rooms; owner_id uuid; intent_value text; task_row public.development_tasks; task_code_value text; normalized text;
begin
  select * into message_row from public.chat_messages where id=target_message_id;
  select * into room_row from public.chat_rooms where id=message_row.room_id and room_key='program_development_primary';
  if room_row.id is null then return null; end if;
  if message_row.message_class='system_result' or message_row.message_class='system_confirmation' then return null; end if;
  if message_row.sender_profile_id is null or message_row.sender_profile_id<>room_row.created_by or not exists(
    select 1 from public.profiles p join public.company_members m on m.profile_id=p.id and m.company_id=room_row.company_id and m.active
    where p.id=message_row.sender_profile_id and p.role='admin' and m.company_role='company_admin'
  ) then
    insert into public.program_development_audit(company_id,room_id,source_message_id,event_key,action,actor_profile_id,details)
    values(room_row.company_id,room_row.id,message_row.id,'program-dev-rejected:'||message_row.id::text,'message_rejected',message_row.sender_profile_id,jsonb_build_object('reason','owner_only')) on conflict(event_key) do nothing;
    return null;
  end if;
  normalized := lower(coalesce(message_row.text_content,''));
  intent_value := case when normalized ~ '(requirement|ความต้องการ|ต้องการ)' then 'requirement'
    when normalized ~ '(bug|บั๊ก|ผิดพลาด|error)' then 'bug'
    when normalized ~ '(ui|หน้าจอ|ออกแบบ)' then 'ui'
    when normalized ~ '(flow|ขั้นตอน|workflow)' then 'flow'
    when normalized ~ '(database|ฐานข้อมูล|schema)' then 'database'
    when normalized ~ '(api|endpoint)' then 'api'
    when normalized ~ '(test|ทดสอบ)' then 'test'
    when normalized ~ '(build|บิลด์)' then 'build'
    when normalized ~ '(deploy|ปล่อยระบบ|ขึ้น production)' then 'deploy' end;
  if intent_value is null then
    insert into public.program_development_audit(company_id,room_id,source_message_id,event_key,action,actor_profile_id,details)
    values(room_row.company_id,room_row.id,message_row.id,'program-dev-rejected:'||message_row.id::text,'message_rejected',message_row.sender_profile_id,jsonb_build_object('reason','not_development_intent')) on conflict(event_key) do nothing;
    return null;
  end if;
  task_code_value := 'DEV-'||to_char(now() at time zone 'Asia/Bangkok','YYYYMMDD')||'-'||upper(left(replace(message_row.id::text,'-',''),8));
  insert into public.development_tasks(company_id,room_id,source_message_id,event_key,task_code,request_text,intent,owner_profile_id)
  values(room_row.company_id,room_row.id,message_row.id,'program-dev:'||message_row.id::text,task_code_value,coalesce(message_row.text_content,''),intent_value,room_row.created_by)
  on conflict(source_message_id) do update set updated_at=now()
  returning * into task_row;
  insert into public.development_task_dispatches(company_id,task_id,target,event_key)
  values(task_row.company_id,task_row.id,'codex','program-dev-dispatch:'||task_row.id::text)
  on conflict(task_id,target) do nothing;
  insert into public.program_development_audit(company_id,task_id,room_id,source_message_id,event_key,action,actor_profile_id,details)
  values(task_row.company_id,task_row.id,task_row.room_id,task_row.source_message_id,'program-dev-task-created:'||task_row.id::text,'task_received',task_row.owner_profile_id,jsonb_build_object('task_id',task_row.id,'task_code',task_row.task_code,'intent',task_row.intent)) on conflict(event_key) do nothing;
  return task_row;
end $$;

create or replace function public.transition_program_development_task(target_task_id uuid,target_status text,target_result_summary text default null,target_commit_ref text default null,target_test_result text default null,target_build_result text default null,target_deploy_result text default null,target_blocker text default null)
returns public.development_tasks language plpgsql security definer set search_path=public as $$
declare task_row public.development_tasks; before_status text;
begin
  select * into task_row from public.development_tasks where id=target_task_id for update;
  if task_row.id is null or not public.is_program_development_owner(task_row.company_id) then raise exception 'program_development_task_owner_required'; end if;
  if target_status not in ('received','in_progress','waiting_review','completed','blocked') then raise exception 'program_development_status_invalid'; end if;
  before_status:=task_row.status;
  update public.development_tasks set status=target_status,result_summary=coalesce(target_result_summary,result_summary),commit_ref=coalesce(target_commit_ref,commit_ref),test_result=coalesce(target_test_result,test_result),build_result=coalesce(target_build_result,build_result),deploy_result=coalesce(target_deploy_result,deploy_result),blocker=coalesce(target_blocker,blocker),updated_at=now() where id=task_row.id returning * into task_row;
  insert into public.program_development_audit(company_id,task_id,room_id,event_key,action,actor_profile_id,details)
  values(task_row.company_id,task_row.id,task_row.room_id,'program-dev-status:'||task_row.id::text||':'||task_row.updated_at::text,'status_changed',auth.uid(),jsonb_build_object('from',before_status,'to',target_status)) on conflict(event_key) do nothing;
  return task_row;
end $$;

create or replace function public.route_program_development_message_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.route_program_development_message(new.id);
  return new;
exception when others then
  insert into public.program_development_audit(company_id,room_id,source_message_id,event_key,action,actor_profile_id,details)
  values(new.company_id,new.room_id,new.id,'program-dev-route-failed:'||new.id::text,'route_failed',new.sender_profile_id,jsonb_build_object('error',left(sqlerrm,1000))) on conflict(event_key) do nothing;
  return new;
end $$;
drop trigger if exists route_program_development_message_trigger on public.chat_messages;
create trigger route_program_development_message_trigger
after insert on public.chat_messages for each row execute function public.route_program_development_message_trigger();

revoke all on function public.ensure_standard_program_development_room(uuid),public.route_program_development_message(uuid),public.transition_program_development_task(uuid,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.ensure_standard_program_development_room(uuid),public.route_program_development_message(uuid),public.transition_program_development_task(uuid,text,text,text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';

;
