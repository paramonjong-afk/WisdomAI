begin;

do $$
declare
  target_company_id uuid;
  target_profile_id uuid;
  matched_profiles integer;
  latest_chat_id text;
  latest_chat_title text;
begin
  select id
    into target_company_id
  from public.companies
  where name = 'WisdomAI Construction'
    and active = true;

  if target_company_id is null then
    raise exception 'Confirmed company WisdomAI Construction was not found';
  end if;

  select count(*)
    into matched_profiles
  from public.profiles p
  join public.company_members member
    on member.profile_id = p.id
   and member.company_id = target_company_id
  where btrim(p.full_name) = 'ทวีชัย ภรามร'
    and member.active = true
    and (member.ends_on is null or member.ends_on >= current_date);

  if matched_profiles <> 1 then
    raise exception 'Expected exactly one active company member named ทวีชัย ภรามร, found %', matched_profiles;
  end if;

  select p.id
    into strict target_profile_id
  from public.profiles p
  join public.company_members member
    on member.profile_id = p.id
   and member.company_id = target_company_id
  where btrim(p.full_name) = 'ทวีชัย ภรามร'
    and member.active = true
    and (member.ends_on is null or member.ends_on >= current_date);

  if not exists (
    select 1
    from public.company_members member
    where member.company_id = target_company_id
      and member.profile_id = target_profile_id
      and member.active = true
      and (member.ends_on is null or member.ends_on >= current_date)
      and member.company_role in ('company_admin', 'executive', 'manager')
  ) then
    raise exception 'Confirmed profile does not already have an eligible Telegram admin role';
  end if;

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
    '8518319056',
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

  select event.telegram_chat_id
    into latest_chat_id
  from public.telegram_admin_events event
  where event.telegram_user_id = '8518319056'
    and event.telegram_chat_id is not null
  order by event.created_at desc
  limit 1;

  if latest_chat_id is not null then
    latest_chat_title := 'Admin';

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
      latest_chat_title,
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
    join public.company_members member
      on member.company_id = account.company_id
     and member.profile_id = account.profile_id
    where account.company_id = target_company_id
      and account.profile_id = target_profile_id
      and account.telegram_user_id = '8518319056'
      and account.active = true
      and member.active = true
      and member.company_role in ('company_admin', 'executive', 'manager')
  ) then
    raise exception 'Telegram admin link verification failed';
  end if;
end;
$$;

commit;
