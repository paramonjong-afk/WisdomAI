-- Secure, one-time LINE account linking initiated from a LINE group.
create table if not exists public.line_account_link_tokens(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  line_user_id text not null references public.line_senders(line_user_id) on delete cascade,
  line_group_id text references public.line_groups(line_group_id) on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists line_link_token_lookup_idx on public.line_account_link_tokens(token_hash) where used_at is null;
alter table public.line_account_link_tokens enable row level security;

create or replace function public.claim_line_account(one_time_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  token_row public.line_account_link_tokens;
  existing_profile uuid;
  employee_name text;
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
  where line_user_id=token_row.line_user_id limit 1;
  if existing_profile is not null and existing_profile<>auth.uid() then
    raise exception 'LINE นี้ผูกกับพนักงานคนอื่นอยู่ กรุณาติดต่อ Admin';
  end if;

  insert into public.employee_line_accounts(profile_id,line_user_id,verified_at,verified_by,active,updated_at)
  values(auth.uid(),token_row.line_user_id,now(),auth.uid(),true,now())
  on conflict(profile_id) do update set
    line_user_id=excluded.line_user_id,verified_at=excluded.verified_at,
    verified_by=excluded.verified_by,active=true,updated_at=now();
  update public.line_senders set profile_id=auth.uid(),updated_at=now() where line_user_id=token_row.line_user_id;
  update public.line_account_link_tokens set used_at=now(),used_by=auth.uid() where id=token_row.id;
  select coalesce(nullif(trim(full_name),''),email) into employee_name from public.profiles where id=auth.uid();
  return jsonb_build_object('profile_id',auth.uid(),'employee_name',employee_name,'company_id',token_row.company_id);
end $$;

revoke all on function public.claim_line_account(text) from public;
grant execute on function public.claim_line_account(text) to authenticated;

comment on function public.claim_line_account is
  'Claims a LINE sender using a 10-minute single-use token and the authenticated employee identity.';
