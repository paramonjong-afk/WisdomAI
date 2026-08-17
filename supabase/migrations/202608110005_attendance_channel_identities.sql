-- ATT-IDENTITY-001: company-scoped identities for LINE and Telegram attendance.
create table if not exists public.attendance_channel_identities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check(channel in ('line','telegram')),
  external_user_id text not null,
  display_name text,
  verified_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,channel,external_user_id),
  unique(company_id,channel,profile_id)
);
create index if not exists attendance_channel_identities_profile_idx
  on public.attendance_channel_identities(company_id,profile_id,active);

alter table public.attendance_channel_identities enable row level security;
create policy "Members read own channel identities" on public.attendance_channel_identities
  for select to authenticated using(company_id=public.current_company_id() and (profile_id=auth.uid() or public.is_company_manager(company_id)));
create policy "Managers manage channel identities" on public.attendance_channel_identities
  for all to authenticated using(company_id=public.current_company_id() and public.is_company_manager(company_id))
  with check(company_id=public.current_company_id() and public.is_company_manager(company_id));

create or replace function public.link_attendance_channel_identity(target_profile_id uuid,target_channel text,target_external_user_id text,target_display_name text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id(); identity_id uuid;
begin
  if company is null or not public.is_company_manager(company) then raise exception 'manager_permission_required'; end if;
  if target_channel not in ('line','telegram') then raise exception 'invalid_channel'; end if;
  if nullif(trim(coalesce(target_external_user_id,'')),'') is null then raise exception 'external_user_id_required'; end if;
  if not exists(select 1 from public.company_members where company_id=company and profile_id=target_profile_id and active=true) then raise exception 'profile_not_in_current_company'; end if;
  insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,display_name,verified_by,active,updated_at)
  values(company,target_profile_id,target_channel,trim(target_external_user_id),nullif(trim(coalesce(target_display_name,'')),''),auth.uid(),true,now())
  on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,display_name=excluded.display_name,verified_at=now(),verified_by=auth.uid(),active=true,updated_at=now()
  returning id into identity_id;
  return identity_id;
end $$;
revoke all on function public.link_attendance_channel_identity(uuid,text,text,text) from public;
grant execute on function public.link_attendance_channel_identity(uuid,text,text,text) to authenticated;

create or replace function public.unlink_attendance_channel_identity(target_identity_id uuid,unlink_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare company uuid:=public.current_company_id();
begin
  if company is null or not public.is_company_manager(company) then raise exception 'manager_permission_required'; end if;
  if length(trim(coalesce(unlink_reason,'')))<3 then raise exception 'unlink_reason_required'; end if;
  update public.attendance_channel_identities set active=false,updated_at=now()
  where id=target_identity_id and company_id=company;
  if not found then raise exception 'identity_not_found_in_current_company'; end if;
end $$;
revoke all on function public.unlink_attendance_channel_identity(uuid,text) from public;
grant execute on function public.unlink_attendance_channel_identity(uuid,text) to authenticated;

insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,verified_at,active)
select member.company_id,account.profile_id,'line',account.line_user_id,coalesce(account.verified_at,now()),account.active
from public.employee_line_accounts account join public.company_members member on member.profile_id=account.profile_id and member.active=true
on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,verified_at=excluded.verified_at,active=excluded.active,updated_at=now();

insert into public.attendance_channel_identities(company_id,profile_id,channel,external_user_id,display_name,verified_at,active)
select account.company_id,account.profile_id,'telegram',account.telegram_user_id,account.display_name,account.linked_at,account.active
from public.telegram_admin_accounts account
on conflict(company_id,channel,external_user_id) do update set profile_id=excluded.profile_id,verified_at=excluded.verified_at,active=excluded.active,updated_at=now();

update public.system_work_items set status='doing',progress=45,detail='Company-scoped LINE/Telegram employee identity registry and manager-only link/unlink RPC prepared.',production_status='migration_ready_for_production',updated_at=now() where work_key='ATT-IDENTITY-001';
