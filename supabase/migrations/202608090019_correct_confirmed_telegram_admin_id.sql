begin;

do $$
declare
  target_company_id uuid;
  target_profile_id uuid;
  matched_profiles integer;
  latest_chat_id text;
begin
  select id
    into strict target_company_id
  from public.companies
  where name = 'WisdomAI Construction'
    and active = true;

  select count(*)
    into matched_profiles
  from public.profiles profile
  join public.company_members member
    on member.profile_id = profile.id
   and member.company_id = target_company_id
  where btrim(profile.full_name) = 'ทวีชัย ภรามร'
    and member.active = true
    and (member.ends_on is null or member.ends_on >= current_date)
    and member.company_role in ('company_admin', 'executive', 'manager');

  if matched_profiles <> 1 then
    raise exception 'Expected exactly one eligible admin named ทวีชัย ภรามร, found %', matched_profiles;
  end if;

  select profile.id
    into strict target_profile_id
  from public.profiles profile
  join public.company_members member
    on member.profile_id = profile.id
   and member.company_id = target_company_id
  where btrim(profile.full_name) = 'ทวีชัย ภรามร'
    and member.active = true
    and (member.ends_on is null or member.ends_on >= current_date)
    and member.company_role in ('company_admin', 'executive', 'manager');

  if exists (
    select 1
    from public.telegram_admin_accounts account
    where account.company_id = target_company_id
      and account.telegram_user_id = '8548319056'
      and account.profile_id <> target_profile_id
  ) then
    raise exception 'Confirmed Telegram user ID is already linked to another profile in this company';
  end if;

  update public.telegram_admin_accounts
  set telegram_user_id = '8548319056',
      display_name = 'ทวีชัย ภรามร',
      active = true,
      updated_at = now()
  where company_id = target_company_id
    and profile_id = target_profile_id
    and telegram_user_id = '8518319056';

  if not found then
    insert into public.telegram_admin_accounts (
      company_id,
      profile_id,
      telegram_user_id,
      display_name,
      active,
      linked_at,
      updated_at
    ) values (
      target_company_id,
      target_profile_id,
      '8548319056',
      'ทวีชัย ภรามร',
      true,
      now(),
      now()
    )
    on conflict (company_id, profile_id) do update
    set telegram_user_id = excluded.telegram_user_id,
        display_name = excluded.display_name,
        active = true,
        updated_at = now();
  end if;

  select event.telegram_chat_id
    into latest_chat_id
  from public.telegram_admin_events event
  where event.telegram_user_id = '8548319056'
    and event.telegram_chat_id is not null
  order by event.created_at desc
  limit 1;

  if latest_chat_id is not null then
    insert into public.telegram_admin_chats (
      company_id,
      telegram_chat_id,
      title,
      active,
      created_by,
      updated_at
    ) values (
      target_company_id,
      latest_chat_id,
      'Admin',
      true,
      target_profile_id,
      now()
    )
    on conflict (company_id, telegram_chat_id) do update
    set title = excluded.title,
        active = true,
        updated_at = now();
  end if;

  if not exists (
    select 1
    from public.telegram_admin_accounts account
    where account.company_id = target_company_id
      and account.profile_id = target_profile_id
      and account.telegram_user_id = '8548319056'
      and account.active = true
  ) or exists (
    select 1
    from public.telegram_admin_accounts account
    where account.company_id = target_company_id
      and account.telegram_user_id = '8518319056'
  ) then
    raise exception 'Telegram identity correction verification failed';
  end if;
end;
$$;

commit;
