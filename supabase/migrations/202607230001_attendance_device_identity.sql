alter table public.attendance_sessions
  add column if not exists clock_in_device_id text,
  add column if not exists clock_in_device_info jsonb,
  add column if not exists clock_out_device_id text,
  add column if not exists clock_out_device_info jsonb;

comment on column public.attendance_sessions.clock_in_device_id is
'Random installation identifier stored in the browser. It is not a hardware serial number.';
comment on column public.attendance_sessions.clock_in_device_info is
'Browser supplied device label, platform, user agent, screen size and timezone at clock in.';
comment on column public.attendance_sessions.clock_out_device_info is
'Browser supplied device label, platform, user agent, screen size and timezone at clock out.';

create or replace function public.set_profile_full_name(
  target_profile_id uuid,
  new_full_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_name text := trim(new_full_name);
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if auth.uid() <> target_profile_id and not public.is_work_manager() then
    raise exception 'Permission denied';
  end if;

  if cleaned_name is null or length(cleaned_name) < 2 or length(cleaned_name) > 120 then
    raise exception 'กรุณาระบุชื่อพนักงาน 2-120 ตัวอักษร';
  end if;

  update public.profiles
  set full_name = cleaned_name,
      updated_at = now()
  where id = target_profile_id;

  if not found then
    raise exception 'ไม่พบข้อมูลพนักงาน';
  end if;
end;
$$;

revoke all on function public.set_profile_full_name(uuid, text) from public;
grant execute on function public.set_profile_full_name(uuid, text) to authenticated;
