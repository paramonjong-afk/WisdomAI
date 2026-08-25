-- EMP-LINE-002: allow one employee to own multiple LINE identities per company.
alter table public.employee_line_accounts add column if not exists is_primary boolean not null default false;
alter table public.employee_line_accounts add column if not exists account_label text;

update public.employee_line_accounts account
set is_primary = true
where account.active = true
  and account.id = (
    select candidate.id from public.employee_line_accounts candidate
    where candidate.company_id = account.company_id and candidate.profile_id = account.profile_id and candidate.active = true
    order by candidate.verified_at desc, candidate.id limit 1
  );

alter table public.employee_line_accounts drop constraint if exists employee_line_accounts_company_profile_key;
create unique index if not exists employee_line_accounts_one_primary_idx
  on public.employee_line_accounts(company_id,profile_id) where active = true and is_primary = true;

alter table public.attendance_channel_identities
  drop constraint if exists attendance_channel_identities_company_id_channel_profile_id_key;
create index if not exists attendance_channel_identities_profile_channel_idx
  on public.attendance_channel_identities(company_id,profile_id,channel,active);

create or replace function public.admin_add_employee_line_account(
  target_profile_id uuid,
  target_line_user_id text,
  make_primary boolean default false,
  link_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  normalized_line_user_id text := nullif(trim(target_line_user_id), '');
  target_sender public.line_senders%rowtype;
  existing_account public.employee_line_accounts%rowtype;
  result_id uuid;
  should_be_primary boolean;
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบก่อนผูกบัญชี LINE'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'คุณไม่มีสิทธิ์ผูกบัญชี LINE ให้พนักงานในบริษัทนี้'; end if;
  if target_profile_id is null or normalized_line_user_id is null then raise exception 'กรุณาเลือกพนักงานและบัญชี LINE ให้ครบ'; end if;
  if length(trim(coalesce(link_reason,''))) < 3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if not exists (select 1 from public.company_members m where m.company_id=target_company_id and m.profile_id=target_profile_id and m.active=true) then raise exception 'ไม่พบพนักงานที่ใช้งานอยู่ในบริษัทปัจจุบัน'; end if;

  select * into target_sender from public.line_senders s
  where s.company_id=target_company_id and s.line_user_id=normalized_line_user_id for update;
  if target_sender.line_user_id is null then raise exception 'ไม่พบ LINE Candidate ในบริษัทปัจจุบัน'; end if;

  select * into existing_account from public.employee_line_accounts a
  where a.company_id=target_company_id and a.line_user_id=normalized_line_user_id for update;
  if existing_account.id is not null and existing_account.active and existing_account.profile_id<>target_profile_id then raise exception 'LINE นี้ผูกกับพนักงานคนอื่นอยู่แล้ว กรุณาตรวจสอบก่อน'; end if;

  should_be_primary := make_primary or not exists (
    select 1 from public.employee_line_accounts a where a.company_id=target_company_id and a.profile_id=target_profile_id and a.active=true and a.is_primary=true
  );
  if should_be_primary then
    update public.employee_line_accounts set is_primary=false,updated_at=now()
    where company_id=target_company_id and profile_id=target_profile_id and active=true and is_primary=true;
  end if;

  insert into public.employee_line_accounts(company_id,profile_id,line_user_id,verified_at,verified_by,active,is_primary,account_label,updated_at)
  values(target_company_id,target_profile_id,normalized_line_user_id,now(),(select auth.uid()),true,should_be_primary,case when should_be_primary then 'บัญชีหลัก' else 'บัญชีรอง' end,now())
  on conflict(company_id,line_user_id) do update set profile_id=excluded.profile_id,verified_at=now(),verified_by=(select auth.uid()),active=true,is_primary=excluded.is_primary,account_label=excluded.account_label,updated_at=now()
  returning id into result_id;

  insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,display_name,verified_at,verified_by,active,updated_at)
  values(target_company_id,target_profile_id,'line',normalized_line_user_id,target_sender.display_name,now(),(select auth.uid()),true,now())
  on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,display_name=excluded.display_name,verified_at=now(),verified_by=(select auth.uid()),active=true,updated_at=now();
  update public.line_senders set profile_id=target_profile_id,updated_at=now() where company_id=target_company_id and line_user_id=normalized_line_user_id;

  insert into public.employee_workforce_audit_logs(company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values)
  values(target_company_id,target_profile_id,(select auth.uid()),'employee_line_account',result_id,
    case when existing_account.id is null then 'linked_additional' else 'relinked' end,trim(link_reason),
    case when existing_account.id is null then null else jsonb_build_object('profile_id',existing_account.profile_id,'active',existing_account.active,'is_primary',existing_account.is_primary) end,
    jsonb_build_object('line_user_id',normalized_line_user_id,'display_name',target_sender.display_name,'active',true,'is_primary',should_be_primary,'source','employee_drawer'));
  return jsonb_build_object('status',case when existing_account.id is not null and existing_account.active and existing_account.profile_id=target_profile_id then 'already_linked' else 'linked' end,'account_id',result_id,'is_primary',should_be_primary);
end $$;
revoke all on function public.admin_add_employee_line_account(uuid,text,boolean,text) from public;
revoke all on function public.admin_add_employee_line_account(uuid,text,boolean,text) from anon;
grant execute on function public.admin_add_employee_line_account(uuid,text,boolean,text) to authenticated;

create or replace function public.admin_unlink_employee_line_identity(target_profile_id uuid,target_line_user_id text,unlink_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_company_id uuid:=public.current_company_id(); existing_account public.employee_line_accounts%rowtype; promoted_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then raise exception 'คุณไม่มีสิทธิ์ยกเลิกการผูก LINE ในบริษัทนี้'; end if;
  if length(trim(coalesce(unlink_reason,'')))<3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  select * into existing_account from public.employee_line_accounts a where a.company_id=target_company_id and a.profile_id=target_profile_id and a.line_user_id=trim(target_line_user_id) and a.active=true for update;
  if existing_account.id is null then return jsonb_build_object('status','already_unlinked'); end if;
  update public.employee_line_accounts set active=false,is_primary=false,updated_at=now() where id=existing_account.id;
  update public.attendance_channel_identities set active=false,updated_at=now() where company_id=target_company_id and profile_id=target_profile_id and channel='line' and external_user_id=existing_account.line_user_id;
  update public.line_senders set profile_id=null,updated_at=now() where company_id=target_company_id and line_user_id=existing_account.line_user_id and profile_id=target_profile_id;
  if existing_account.is_primary then
    select id into promoted_id from public.employee_line_accounts a where a.company_id=target_company_id and a.profile_id=target_profile_id and a.active=true order by a.verified_at desc limit 1 for update;
    if promoted_id is not null then update public.employee_line_accounts set is_primary=true,account_label='บัญชีหลัก',updated_at=now() where id=promoted_id; end if;
  end if;
  insert into public.employee_workforce_audit_logs(company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,old_values,new_values)
  values(target_company_id,target_profile_id,(select auth.uid()),'employee_line_account',existing_account.id,'unlinked_identity',trim(unlink_reason),jsonb_build_object('line_user_id',existing_account.line_user_id,'active',true,'is_primary',existing_account.is_primary),jsonb_build_object('line_user_id',existing_account.line_user_id,'active',false,'promoted_account_id',promoted_id,'source','employee_drawer'));
  return jsonb_build_object('status','unlinked','line_user_id',existing_account.line_user_id,'promoted_account_id',promoted_id);
end $$;
revoke all on function public.admin_unlink_employee_line_identity(uuid,text,text) from public;
revoke all on function public.admin_unlink_employee_line_identity(uuid,text,text) from anon;
grant execute on function public.admin_unlink_employee_line_identity(uuid,text,text) to authenticated;

create or replace function public.claim_line_account(one_time_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare token_row public.line_account_link_tokens; existing_profile uuid; employee_name text; should_be_primary boolean;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อนผูกบัญชี LINE'; end if;
  select * into token_row from public.line_account_link_tokens where token_hash=encode(digest(trim(one_time_token),'sha256'),'hex') for update;
  if token_row.id is null or token_row.used_at is not null or token_row.expires_at<now() then raise exception 'ลิงก์ผูกบัญชีไม่ถูกต้อง ถูกใช้แล้ว หรือหมดอายุ'; end if;
  if not public.is_company_member(token_row.company_id) then raise exception 'บัญชีนี้ไม่ได้อยู่ในบริษัทของกลุ่ม LINE'; end if;
  select profile_id into existing_profile from public.employee_line_accounts where company_id=token_row.company_id and line_user_id=token_row.line_user_id and active=true limit 1;
  if existing_profile is not null and existing_profile<>auth.uid() then raise exception 'LINE นี้ผูกกับพนักงานคนอื่นในบริษัทอยู่ กรุณาติดต่อ Admin'; end if;
  should_be_primary := not exists(select 1 from public.employee_line_accounts where company_id=token_row.company_id and profile_id=auth.uid() and active=true and is_primary=true);
  insert into public.employee_line_accounts(company_id,profile_id,line_user_id,verified_at,verified_by,active,is_primary,account_label,updated_at)
  values(token_row.company_id,auth.uid(),token_row.line_user_id,now(),auth.uid(),true,should_be_primary,case when should_be_primary then 'บัญชีหลัก' else 'บัญชีรอง' end,now())
  on conflict(company_id,line_user_id) do update set profile_id=excluded.profile_id,verified_at=now(),verified_by=auth.uid(),active=true,is_primary=excluded.is_primary,account_label=excluded.account_label,updated_at=now();
  insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,verified_at,verified_by,active,updated_at)
  values(token_row.company_id,auth.uid(),'line',token_row.line_user_id,now(),auth.uid(),true,now())
  on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,verified_at=now(),verified_by=auth.uid(),active=true,updated_at=now();
  update public.line_senders set profile_id=auth.uid(),updated_at=now() where company_id=token_row.company_id and line_user_id=token_row.line_user_id and (profile_id is null or profile_id=auth.uid());
  update public.line_account_link_tokens set used_at=now(),used_by=auth.uid() where id=token_row.id;
  select coalesce(nullif(trim(full_name),''),email) into employee_name from public.profiles where id=auth.uid();
  return jsonb_build_object('profile_id',auth.uid(),'employee_name',employee_name,'company_id',token_row.company_id,'is_primary',should_be_primary);
end $$;
revoke all on function public.claim_line_account(text) from public;
revoke all on function public.claim_line_account(text) from anon;
grant execute on function public.claim_line_account(text) to authenticated;
