-- Platform administrators can discover and select every company, while all
-- operational tables remain scoped to the single active company.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.profiles
    where id=auth.uid() and role='admin'
  );
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(
    (
      select preference.active_company_id
      from public.user_company_preferences preference
      join public.companies company on company.id=preference.active_company_id and company.active
      where preference.profile_id=auth.uid()
        and (
          public.is_platform_admin()
          or exists(
            select 1 from public.company_members member
            where member.company_id=preference.active_company_id
              and member.profile_id=auth.uid()
              and member.active
              and (member.ends_on is null or member.ends_on>=current_date)
          )
        )
    ),
    (
      select member.company_id
      from public.company_members member
      join public.companies company on company.id=member.company_id and company.active
      where member.profile_id=auth.uid()
        and member.active
        and (member.ends_on is null or member.ends_on>=current_date)
      order by member.created_at
      limit 1
    ),
    (
      select company.id from public.companies company
      where company.active and public.is_platform_admin()
      order by company.created_at
      limit 1
    )
  );
$$;

create or replace function public.is_company_manager(target_company_id uuid default public.current_company_id())
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.is_platform_admin() or exists(
    select 1 from public.company_members member
    where member.company_id=target_company_id
      and member.profile_id=auth.uid()
      and member.active
      and member.company_role in ('company_admin','executive','manager')
      and (member.ends_on is null or member.ends_on>=current_date)
  );
$$;

create or replace function public.get_my_companies()
returns table(company_id uuid,company_name text,company_slug text,company_role text,is_active boolean)
language sql
stable
security definer
set search_path=public
as $$
  select company.id,
    company.name,
    company.slug,
    coalesce(member.company_role,'company_admin'),
    company.id=public.current_company_id()
  from public.companies company
  left join public.company_members member
    on member.company_id=company.id
    and member.profile_id=auth.uid()
    and member.active
    and (member.ends_on is null or member.ends_on>=current_date)
  where company.active
    and (public.is_platform_admin() or member.profile_id is not null)
  order by 5 desc,company.name;
$$;

alter table public.app_activity_logs drop constraint if exists app_activity_logs_event_type_check;
alter table public.app_activity_logs add constraint app_activity_logs_event_type_check check(event_type in(
  'session_start','session_end','page_view','client_error','request_error','export_data',
  'company_created','company_switched'
));

create or replace function public.switch_company(target_company_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare target_exists boolean;
begin
  select exists(select 1 from public.companies where id=target_company_id and active)
  into target_exists;
  if not target_exists then raise exception 'ไม่พบบริษัทที่เปิดใช้งาน'; end if;
  if not public.is_platform_admin() and not public.is_company_member(target_company_id) then
    raise exception 'ไม่มีสิทธิ์ใช้งานบริษัทนี้';
  end if;

  insert into public.user_company_preferences(profile_id,active_company_id,updated_at)
  values(auth.uid(),target_company_id,now())
  on conflict(profile_id) do update
    set active_company_id=excluded.active_company_id,updated_at=now();

  insert into public.app_activity_logs(profile_id,company_id,event_type,severity,message,metadata)
  values(auth.uid(),target_company_id,'company_switched','info','เปลี่ยนบริษัทที่กำลังใช้งาน',
    jsonb_build_object('company_id',target_company_id));
end;
$$;

create or replace function public.assign_current_company()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.company_id is null then new.company_id:=public.current_company_id(); end if;
  if new.company_id is null then raise exception 'กรุณาเลือกบริษัทก่อนบันทึกข้อมูล'; end if;
  if auth.uid() is not null
    and not public.is_company_member(new.company_id)
    and not (
      public.is_platform_admin()
      and (
        new.company_id=public.current_company_id()
        or current_setting('app.platform_company_bootstrap',true)='on'
      )
    )
  then raise exception 'ไม่มีสิทธิ์บันทึกข้อมูลบริษัทนี้'; end if;
  return new;
end;
$$;

create or replace function public.enforce_company_write_boundary()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare active_company uuid:=public.current_company_id();
declare bootstrap_allowed boolean:=public.is_platform_admin()
  and current_setting('app.platform_company_bootstrap',true)='on';
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if active_company is null and not bootstrap_allowed then
    raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ';
  end if;
  if tg_op='DELETE' then
    if old.company_id<>active_company then
      raise exception 'ไม่อนุญาตให้แก้ไขข้อมูลข้ามบริษัท';
    end if;
    return old;
  end if;
  if tg_op='INSERT' and new.company_id is null then new.company_id:=active_company; end if;
  if not bootstrap_allowed
    and (new.company_id<>active_company or (tg_op='UPDATE' and old.company_id<>active_company))
  then raise exception 'ไม่อนุญาตให้แก้ไขข้อมูลข้ามบริษัท'; end if;
  return new;
end;
$$;

create or replace function public.create_company(company_name text,company_slug text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare new_company_id uuid;
begin
  if auth.uid() is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if not public.is_platform_admin() then raise exception 'เฉพาะ Platform Admin เท่านั้นที่สร้างบริษัทได้'; end if;
  if nullif(trim(company_name),'') is null or nullif(trim(company_slug),'') is null then
    raise exception 'กรุณาระบุชื่อและรหัสบริษัท';
  end if;
  if lower(trim(company_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'รหัสบริษัทใช้ได้เฉพาะ a-z, 0-9 และขีดกลาง';
  end if;

  perform set_config('app.platform_company_bootstrap','on',true);
  insert into public.companies(name,slug)
  values(trim(company_name),lower(trim(company_slug)))
  returning id into new_company_id;

  insert into public.company_members(company_id,profile_id,company_role)
  values(new_company_id,auth.uid(),'company_admin');
  insert into public.user_company_preferences(profile_id,active_company_id,updated_at)
  values(auth.uid(),new_company_id,now())
  on conflict(profile_id) do update
    set active_company_id=excluded.active_company_id,updated_at=now();
  perform set_config('app.platform_company_bootstrap','off',true);

  insert into public.project_cost_codes(company_id,code,name_th,sort_order)
  select new_company_id,code,name_th,sort_order
  from public.project_cost_codes
  where company_id=(select id from public.companies where slug='wisdomai-default')
    and new_company_id<>(select id from public.companies where slug='wisdomai-default')
  on conflict(company_id,code) do nothing;

  insert into public.app_activity_logs(profile_id,company_id,event_type,severity,message,metadata)
  values(auth.uid(),new_company_id,'company_created','info','สร้างบริษัทใหม่',
    jsonb_build_object('company_id',new_company_id,'company_slug',lower(trim(company_slug))));
  return new_company_id;
exception
  when unique_violation then
    raise exception 'รหัสบริษัทนี้ถูกใช้งานแล้ว';
end;
$$;

revoke execute on function public.is_platform_admin() from public,anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.get_my_companies() to authenticated;
grant execute on function public.switch_company(uuid) to authenticated;
grant execute on function public.create_company(text,text) to authenticated;

