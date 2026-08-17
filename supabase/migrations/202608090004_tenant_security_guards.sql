create or replace function public.is_work_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_company_manager(public.current_company_id()); $$;

create or replace function public.enforce_company_write_boundary()
returns trigger language plpgsql security definer set search_path=public
as $$
declare active_company uuid:=public.current_company_id();
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if active_company is null then raise exception 'กรุณาเลือกบริษัทก่อนทำรายการ'; end if;
  if tg_op='DELETE' then
    if old.company_id<>active_company then raise exception 'ไม่อนุญาตให้แก้ไขข้อมูลข้ามบริษัท'; end if;
    return old;
  end if;
  if tg_op='INSERT' and new.company_id is null then new.company_id:=active_company; end if;
  if new.company_id<>active_company or (tg_op='UPDATE' and old.company_id<>active_company) then
    raise exception 'ไม่อนุญาตให้แก้ไขข้อมูลข้ามบริษัท';
  end if;
  return new;
end;
$$;

do $$
declare item record;
begin
  for item in select table_name from information_schema.columns
    where table_schema='public' and column_name='company_id'
      and table_name not in ('companies','company_members')
  loop
    execute format('drop trigger if exists %I on public.%I','enforce_company_write_'||item.table_name,item.table_name);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.enforce_company_write_boundary()','enforce_company_write_'||item.table_name,item.table_name);
  end loop;
end $$;

drop policy if exists "Company profile visibility" on public.profiles;
create policy "Company profile visibility" on public.profiles as restrictive for select to authenticated
using(
  id=auth.uid() or exists(
    select 1 from public.company_members mine join public.company_members theirs on theirs.company_id=mine.company_id
    where mine.profile_id=auth.uid() and mine.company_id=public.current_company_id() and mine.active
      and theirs.profile_id=profiles.id and theirs.active
  )
);

-- เอกสารพนักงานที่ใช้โฟลเดอร์ profile_id ต้องเห็นได้เฉพาะสมาชิกบริษัทปัจจุบัน
drop policy if exists "Tenant employee storage visibility" on storage.objects;
create policy "Tenant employee storage visibility" on storage.objects as restrictive for select to authenticated
using(
  bucket_id not in ('attendance-selfies','employee-workforce-documents','employee-private-documents')
  or (storage.foldername(name))[1]=auth.uid()::text
  or exists(
    select 1 from public.company_members m
    where m.company_id=public.current_company_id() and m.profile_id::text=(storage.foldername(name))[1]
      and m.active and public.is_company_manager(m.company_id)
  )
);
