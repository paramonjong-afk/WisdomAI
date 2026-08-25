-- EMP-LINE-001: manager-confirmed LINE identity linking from Employee Drawer.
create or replace function public.admin_link_employee_line_account(
  target_profile_id uuid,
  target_line_user_id text,
  replace_existing boolean default false,
  link_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := public.current_company_id();
  normalized_line_user_id text := nullif(trim(target_line_user_id), '');
  existing_by_profile public.employee_line_accounts%rowtype;
  existing_by_line public.employee_line_accounts%rowtype;
  target_sender public.line_senders%rowtype;
  result_id uuid;
  result_status text := 'linked';
begin
  if (select auth.uid()) is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อนผูกบัญชี LINE';
  end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'คุณไม่มีสิทธิ์ผูกบัญชี LINE ให้พนักงานในบริษัทนี้';
  end if;
  if target_profile_id is null or normalized_line_user_id is null then
    raise exception 'กรุณาเลือกพนักงานและบัญชี LINE ให้ครบ';
  end if;
  if not exists (
    select 1 from public.company_members member
    where member.company_id = target_company_id
      and member.profile_id = target_profile_id
      and member.active = true
  ) then
    raise exception 'ไม่พบพนักงานที่ใช้งานอยู่ในบริษัทปัจจุบัน';
  end if;

  select sender.* into target_sender
  from public.line_senders sender
  where sender.company_id = target_company_id
    and sender.line_user_id = normalized_line_user_id
  for update;
  if target_sender.line_user_id is null then
    raise exception 'ไม่พบ LINE Candidate ในบริษัทปัจจุบัน';
  end if;

  select account.* into existing_by_line
  from public.employee_line_accounts account
  where account.company_id = target_company_id
    and account.line_user_id = normalized_line_user_id
    and account.active = true
  for update;
  if existing_by_line.id is not null and existing_by_line.profile_id <> target_profile_id then
    raise exception 'LINE นี้ผูกกับพนักงานคนอื่นอยู่แล้ว กรุณาตรวจสอบก่อน';
  end if;

  select account.* into existing_by_profile
  from public.employee_line_accounts account
  where account.company_id = target_company_id
    and account.profile_id = target_profile_id
  for update;
  if existing_by_profile.id is not null
     and existing_by_profile.line_user_id = normalized_line_user_id
     and existing_by_profile.active then
    return jsonb_build_object(
      'status', 'already_linked',
      'account_id', existing_by_profile.id,
      'profile_id', target_profile_id,
      'line_user_id', normalized_line_user_id
    );
  end if;
  if existing_by_profile.id is not null
     and existing_by_profile.line_user_id <> normalized_line_user_id
     and not replace_existing then
    raise exception 'พนักงานมี LINE เดิมอยู่แล้ว กรุณายืนยันการเปลี่ยนบัญชี';
  end if;

  if exists (
    select 1 from public.attendance_channel_identities identity_row
    where identity_row.company_id = target_company_id
      and identity_row.channel = 'line'
      and identity_row.external_user_id = normalized_line_user_id
      and identity_row.profile_id <> target_profile_id
  ) then
    raise exception 'LINE นี้เคยผูกเป็นตัวตนลงเวลาของพนักงานคนอื่น กรุณาตรวจ Audit ก่อนเปลี่ยนเจ้าของ';
  end if;

  if existing_by_profile.id is null then
    insert into public.employee_line_accounts(
      company_id, profile_id, line_user_id, verified_at, verified_by, active, updated_at
    ) values (
      target_company_id, target_profile_id, normalized_line_user_id,
      now(), (select auth.uid()), true, now()
    ) returning id into result_id;
  else
    result_status := 'replaced';
    update public.line_senders
      set profile_id = null, updated_at = now()
      where line_user_id = existing_by_profile.line_user_id
        and company_id = target_company_id
        and profile_id = target_profile_id;
    update public.employee_line_accounts
      set line_user_id = normalized_line_user_id,
          verified_at = now(), verified_by = (select auth.uid()),
          active = true, updated_at = now()
      where id = existing_by_profile.id
      returning id into result_id;
  end if;

  insert into public.attendance_channel_identities(
    company_id, profile_id, channel, external_user_id, display_name,
    verified_at, verified_by, active, updated_at
  ) values (
    target_company_id, target_profile_id, 'line', normalized_line_user_id,
    target_sender.display_name, now(), (select auth.uid()), true, now()
  )
  on conflict (company_id, channel, profile_id) do update set
    external_user_id = excluded.external_user_id,
    display_name = excluded.display_name,
    verified_at = now(), verified_by = (select auth.uid()),
    active = true, updated_at = now();

  update public.line_senders
    set profile_id = target_profile_id, updated_at = now()
    where company_id = target_company_id
      and line_user_id = normalized_line_user_id;

  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id,
    action, reason, old_values, new_values
  ) values (
    target_company_id, target_profile_id, (select auth.uid()),
    'employee_line_account', result_id, result_status,
    coalesce(nullif(trim(link_reason), ''), 'ยืนยันการผูกบัญชี LINE จาก Employee Drawer'),
    case when existing_by_profile.id is null then null else jsonb_build_object(
      'line_user_id', existing_by_profile.line_user_id,
      'active', existing_by_profile.active
    ) end,
    jsonb_build_object(
      'line_user_id', normalized_line_user_id,
      'display_name', target_sender.display_name,
      'active', true,
      'source', 'employee_drawer'
    )
  );

  return jsonb_build_object(
    'status', result_status,
    'account_id', result_id,
    'profile_id', target_profile_id,
    'line_user_id', normalized_line_user_id,
    'display_name', target_sender.display_name
  );
end;
$$;

revoke all on function public.admin_link_employee_line_account(uuid,text,boolean,text) from public;
revoke all on function public.admin_link_employee_line_account(uuid,text,boolean,text) from anon;
grant execute on function public.admin_link_employee_line_account(uuid,text,boolean,text) to authenticated;

create or replace function public.admin_unlink_employee_line_account(
  target_profile_id uuid,
  unlink_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid := public.current_company_id();
  existing_account public.employee_line_accounts%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if target_company_id is null or not public.is_company_manager(target_company_id) then
    raise exception 'คุณไม่มีสิทธิ์ยกเลิกการผูก LINE ในบริษัทนี้';
  end if;
  if length(trim(coalesce(unlink_reason, ''))) < 3 then
    raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร';
  end if;
  select account.* into existing_account
  from public.employee_line_accounts account
  where account.company_id = target_company_id
    and account.profile_id = target_profile_id
    and account.active = true
  for update;
  if existing_account.id is null then
    return jsonb_build_object('status', 'already_unlinked', 'profile_id', target_profile_id);
  end if;
  update public.employee_line_accounts set active = false, updated_at = now()
    where id = existing_account.id;
  update public.attendance_channel_identities set active = false, updated_at = now()
    where company_id = target_company_id and profile_id = target_profile_id and channel = 'line';
  update public.line_senders set profile_id = null, updated_at = now()
    where company_id = target_company_id
      and line_user_id = existing_account.line_user_id
      and profile_id = target_profile_id;
  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id,
    action, reason, old_values, new_values
  ) values (
    target_company_id, target_profile_id, (select auth.uid()),
    'employee_line_account', existing_account.id, 'unlinked', trim(unlink_reason),
    jsonb_build_object('line_user_id', existing_account.line_user_id, 'active', true),
    jsonb_build_object('line_user_id', existing_account.line_user_id, 'active', false, 'source', 'employee_drawer')
  );
  return jsonb_build_object('status', 'unlinked', 'profile_id', target_profile_id, 'line_user_id', existing_account.line_user_id);
end;
$$;

revoke all on function public.admin_unlink_employee_line_account(uuid,text) from public;
revoke all on function public.admin_unlink_employee_line_account(uuid,text) from anon;
grant execute on function public.admin_unlink_employee_line_account(uuid,text) to authenticated;
