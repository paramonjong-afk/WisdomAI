-- Cross-channel approval for system work items.
-- Web Chat and Telegram share one decision record and one idempotent RPC.

create table if not exists public.system_work_item_approvals (
  id uuid primary key default gen_random_uuid(),
  work_key text not null references public.system_work_items(work_key) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decision_channel text check (decision_channel in ('web_chat','telegram','web','system')),
  decision_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists system_work_item_approvals_pending_key
  on public.system_work_item_approvals(work_key) where status='pending';
create index if not exists system_work_item_approvals_company_status_idx
  on public.system_work_item_approvals(company_id,status,updated_at desc);

alter table public.system_work_item_approvals enable row level security;
drop policy if exists "Managers read work approvals" on public.system_work_item_approvals;
create policy "Managers read work approvals" on public.system_work_item_approvals
for select to authenticated using (
  company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')
  or company_id is not null and public.is_company_manager(company_id)
);
revoke insert,update,delete on public.system_work_item_approvals from anon,authenticated;

create or replace function public.request_system_work_item_approval(
  target_work_key text,
  target_reason text default null
)
returns public.system_work_item_approvals
language plpgsql security definer set search_path=public as $$
declare
  item public.system_work_items;
  approval public.system_work_item_approvals;
  room public.chat_rooms;
  message_text text;
begin
  select * into item
  from public.system_work_items as wi
  where wi.work_key=upper(trim(target_work_key))
  for update;
  if item.work_key is null then raise exception 'work_item_not_found'; end if;
  if item.status <> 'review' then raise exception 'work_item_not_in_review'; end if;
  if auth.uid() is not null and not (
    (item.company_id is null and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'))
    or (item.company_id is not null and public.is_company_manager(item.company_id))
  ) then raise exception 'approval_request_not_allowed'; end if;

  select * into approval
  from public.system_work_item_approvals as swa
  where swa.work_key=item.work_key and swa.status='pending'
  for update;
  if approval.id is null then
    insert into public.system_work_item_approvals(work_key,company_id,status)
    values(item.work_key,item.company_id,'pending') returning * into approval;
  end if;

  if item.company_id is not null then
    begin
      room := public.ensure_standard_general_work_room(item.company_id);
      message_text := '[WORK_APPROVAL:'||item.work_key||']'||E'\n'
        ||'ขออนุมัติงาน: '||item.title||E'\n'
        ||'ความเสี่ยง: '||item.risk||' · ความคืบหน้า: '||item.progress||'%'||E'\n'
        ||coalesce(item.detail,'-')||E'\n\n'
        ||'กรุณากด อนุมัติ หรือ ไม่อนุมัติ โดยระบบจะตรวจสอบกับคำขอเดียวกัน';
      if not exists (
        select 1 from public.chat_messages as cm
        where cm.room_id=room.id
          and cm.message_class='system_confirmation'
          and cm.text_content like '[WORK_APPROVAL:'||item.work_key||']%'
      ) then
        insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
        values(item.company_id,room.id,null,'text',message_text,'system_confirmation');
      end if;
    exception when others then
      null;
    end;
  end if;
  return approval;
end $$;

create or replace function public.auto_request_system_work_item_approval()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='review' and lower(coalesce(new.production_status,'')) like '%awaiting_approval%' then
    perform public.request_system_work_item_approval(new.work_key,'สร้างคำขออัตโนมัติเมื่อเข้าสถานะรออนุมัติ');
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists auto_request_system_work_item_approval_trigger on public.system_work_items;
create trigger auto_request_system_work_item_approval_trigger
after insert or update of status,production_status on public.system_work_items
for each row execute function public.auto_request_system_work_item_approval();

create or replace function public.decide_system_work_item_approval(
  target_work_key text,
  target_decision text,
  target_reason text,
  target_channel text default 'web_chat',
  target_actor_profile_id uuid default null
)
returns table(result_status text, work_key text, decision_channel text, decision_reason text)
language plpgsql security definer set search_path=public as $$
declare
  item public.system_work_items;
  approval public.system_work_item_approvals;
  next_status text;
  actor uuid := coalesce(target_actor_profile_id,auth.uid());
  room public.chat_rooms;
begin
  if target_decision not in ('approve','reject') then raise exception 'invalid_decision'; end if;
  if target_channel not in ('web_chat','telegram','web','system') then raise exception 'invalid_channel'; end if;
  if nullif(trim(target_reason),'') is null then raise exception 'decision_reason_required'; end if;

  select * into item
  from public.system_work_items as wi
  where wi.work_key=upper(trim(target_work_key))
  for update;
  if item.work_key is null then raise exception 'work_item_not_found'; end if;
  if actor is not null and not (
    (item.company_id is null and exists(select 1 from public.profiles p where p.id=actor and p.role='admin'))
    or (item.company_id is not null and exists(
      select 1 from public.company_members as cm
      where cm.company_id=item.company_id
        and cm.profile_id=actor
        and cm.active
        and cm.company_role in ('company_admin','executive','manager')
        and (cm.ends_on is null or cm.ends_on>=current_date)
    ))
  ) then raise exception 'approval_not_allowed'; end if;

  select * into approval
  from public.system_work_item_approvals as swa
  where swa.work_key=item.work_key
  order by swa.created_at desc
  limit 1
  for update;
  if approval.id is null and item.status='review' then
    insert into public.system_work_item_approvals(work_key,company_id,status)
    values(item.work_key,item.company_id,'pending') returning * into approval;
  end if;
  if approval.id is null then raise exception 'approval_request_not_found'; end if;
  if approval.status <> 'pending' or item.status <> 'review' then
    return query select 'already_decided',item.work_key,coalesce(approval.decision_channel,'system'),coalesce(approval.decision_reason,'');
    return;
  end if;

  next_status := case when target_decision='approve' then 'approved' else 'rejected' end;
  update public.system_work_item_approvals
  set status=next_status,decision_channel=target_channel,decision_by=actor,
      decision_reason=left(trim(target_reason),1000),decided_at=now(),updated_at=now()
  where id=approval.id and status='pending';
  if not found then
    select * into approval
    from public.system_work_item_approvals as swa
    where swa.id=approval.id;
    return query select 'already_decided',item.work_key,coalesce(approval.decision_channel,'system'),coalesce(approval.decision_reason,'');
    return;
  end if;

  update public.system_work_items as swi
  set status=case when target_decision='approve' then 'ready' else 'blocked' end,
      production_status=case when target_decision='approve' then 'approved_for_execution' else 'rejected_by_admin' end,
      evidence=left(case when target_decision='approve' then 'อนุมัติ' else 'ไม่อนุมัติ' end||'ผ่าน '||target_channel||': '||trim(target_reason),4000),
      current_step=case when target_decision='approve' then 'ได้รับอนุมัติ รอเริ่มดำเนินการ' else 'ไม่ผ่านการอนุมัติ' end,
      updated_by=actor,updated_at=now()
  where swi.work_key=item.work_key and swi.status='review';
  if not found then raise exception 'work_item_decision_conflict'; end if;

  if item.company_id is not null then
    select * into room from public.chat_rooms where company_id=item.company_id and room_key='general_work_primary' limit 1;
    if room.id is not null then
      insert into public.chat_messages(company_id,room_id,sender_profile_id,message_type,text_content,message_class)
      values(item.company_id,room.id,null,'text','[WORK_APPROVAL_RESULT:'||item.work_key||']'||E'\n'
        ||case when target_decision='approve' then 'อนุมัติแล้ว' else 'ไม่อนุมัติแล้ว' end
        ||' ผ่าน '||target_channel||E'\nเหตุผล: '||left(trim(target_reason),1000),'system_result');
    end if;
  end if;
  return query select next_status,item.work_key,target_channel,left(trim(target_reason),1000);
end $$;

revoke all on function public.request_system_work_item_approval(text,text) from public,anon;
revoke all on function public.decide_system_work_item_approval(text,text,text,text,uuid) from public,anon;
grant execute on function public.request_system_work_item_approval(text,text) to authenticated;
grant execute on function public.decide_system_work_item_approval(text,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
