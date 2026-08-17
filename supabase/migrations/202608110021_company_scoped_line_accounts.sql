-- TEN-011: scope LINE employee identities to a company.
alter table public.employee_line_accounts add column if not exists id uuid default gen_random_uuid();
alter table public.employee_line_accounts add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.employee_line_accounts account
set id = coalesce(account.id, gen_random_uuid()),
    company_id = coalesce(
      account.company_id,
      (select sender.company_id from public.line_senders sender where sender.line_user_id = account.line_user_id),
      (select preference.active_company_id
       from public.user_company_preferences preference
       join public.company_members preferred_member
         on preferred_member.company_id = preference.active_company_id
        and preferred_member.profile_id = account.profile_id
        and preferred_member.active = true
       where preference.profile_id = account.profile_id),
      (select member.company_id from public.company_members member
       where member.profile_id = account.profile_id and member.active = true
       order by member.created_at limit 1)
    );

do $$ begin
  if exists (select 1 from public.employee_line_accounts where company_id is null or id is null) then
    raise exception 'employee_line_accounts contains identities without a company';
  end if;
end $$;

alter table public.employee_line_accounts drop constraint if exists employee_line_accounts_pkey;
alter table public.employee_line_accounts drop constraint if exists employee_line_accounts_line_user_id_key;
alter table public.employee_line_accounts alter column id set not null;
alter table public.employee_line_accounts alter column company_id set not null;
alter table public.employee_line_accounts add constraint employee_line_accounts_pkey primary key (id);
alter table public.employee_line_accounts add constraint employee_line_accounts_company_profile_key unique (company_id, profile_id);
alter table public.employee_line_accounts add constraint employee_line_accounts_company_line_user_key unique (company_id, line_user_id);
create index if not exists employee_line_accounts_profile_idx on public.employee_line_accounts(profile_id);
create index if not exists employee_line_accounts_line_user_idx on public.employee_line_accounts(line_user_id) where active = true;

drop policy if exists "Employees read own LINE link" on public.employee_line_accounts;
drop policy if exists "Managers manage employee LINE links" on public.employee_line_accounts;
create policy "Employees read own company LINE link" on public.employee_line_accounts
  for select to authenticated using (public.is_company_member(company_id) and (profile_id = auth.uid() or public.is_company_manager(company_id)));
create policy "Managers manage company LINE links" on public.employee_line_accounts
  for all to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

create or replace function public.claim_line_account(one_time_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare token_row public.line_account_link_tokens; existing_profile uuid; employee_name text;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบก่อนผูกบัญชี LINE'; end if;
  if nullif(trim(one_time_token),'') is null then raise exception 'ไม่พบรหัสผูกบัญชี'; end if;
  select * into token_row from public.line_account_link_tokens
  where token_hash=encode(digest(trim(one_time_token),'sha256'),'hex') for update;
  if token_row.id is null then raise exception 'ลิงก์ผูกบัญชีไม่ถูกต้อง'; end if;
  if token_row.used_at is not null then raise exception 'ลิงก์นี้ถูกใช้งานแล้ว'; end if;
  if token_row.expires_at<now() then raise exception 'ลิงก์หมดอายุ กรุณาส่งคำว่า ผูกบัญชี ใน LINE ใหม่'; end if;
  if not public.is_company_member(token_row.company_id) then raise exception 'บัญชีนี้ไม่ได้อยู่ในบริษัทของกลุ่ม LINE'; end if;
  select profile_id into existing_profile from public.employee_line_accounts
  where company_id=token_row.company_id and line_user_id=token_row.line_user_id and active=true limit 1;
  if existing_profile is not null and existing_profile<>auth.uid() then raise exception 'LINE นี้ผูกกับพนักงานคนอื่นในบริษัทอยู่ กรุณาติดต่อ Admin'; end if;
  insert into public.employee_line_accounts(company_id,profile_id,line_user_id,verified_at,verified_by,active,updated_at)
  values(token_row.company_id,auth.uid(),token_row.line_user_id,now(),auth.uid(),true,now())
  on conflict(company_id,profile_id) do update set line_user_id=excluded.line_user_id,verified_at=excluded.verified_at,verified_by=excluded.verified_by,active=true,updated_at=now();
  insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,verified_at,active,updated_at)
  values(token_row.company_id,auth.uid(),'line',token_row.line_user_id,now(),true,now())
  on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,verified_at=excluded.verified_at,active=true,updated_at=now();
  update public.line_senders set profile_id=auth.uid(),updated_at=now()
  where line_user_id=token_row.line_user_id and (profile_id is null or profile_id=auth.uid());
  update public.line_account_link_tokens set used_at=now(),used_by=auth.uid() where id=token_row.id;
  select coalesce(nullif(trim(full_name),''),email) into employee_name from public.profiles where id=auth.uid();
  return jsonb_build_object('profile_id',auth.uid(),'employee_name',employee_name,'company_id',token_row.company_id);
end $$;
revoke all on function public.claim_line_account(text) from public;
grant execute on function public.claim_line_account(text) to authenticated;

update public.system_work_items set progress=65,current_step='company_scoped_schema_and_rpc',production_status='migration_ready_for_production',updated_at=now()
where work_key='TEN-011' and status='doing';
