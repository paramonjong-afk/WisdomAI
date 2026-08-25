-- Full bank-account numbers are encrypted in a private schema. Public Master Data,
-- UI, logs and exports retain only the last four characters and a keyed fingerprint.
create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter table public.master_bank_accounts add column if not exists secure_number_available boolean not null default false;
alter table public.master_bank_accounts add column if not exists is_primary boolean not null default false;

create unique index if not exists master_bank_accounts_one_employee_primary_idx
  on public.master_bank_accounts(company_id, profile_id)
  where profile_id is not null and is_primary and verification_status = 'verified';

with ranked as (
  select id, row_number() over(partition by company_id, profile_id order by verified_at desc nulls last, created_at desc) as position
  from public.master_bank_accounts
  where profile_id is not null and verification_status = 'verified'
)
update public.master_bank_accounts account set is_primary = true, updated_at = now()
from ranked where ranked.id = account.id and ranked.position = 1
  and not exists(
    select 1 from public.master_bank_accounts existing
    where existing.company_id = account.company_id and existing.profile_id = account.profile_id
      and existing.verification_status = 'verified' and existing.is_primary
  );

create table if not exists private.employee_bank_account_secrets (
  bank_account_id uuid primary key references public.master_bank_accounts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  encrypted_account_number bytea not null,
  key_version integer not null default 1 check (key_version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_bank_account_secrets_company_idx
  on private.employee_bank_account_secrets(company_id, bank_account_id);
revoke all on private.employee_bank_account_secrets from public, anon, authenticated;

do $$
begin
  if not exists(select 1 from vault.secrets where name = 'employee_bank_account_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'employee_bank_account_encryption_key',
      'WisdomAI employee bank account encryption and fingerprint key'
    );
  end if;
end $$;

create or replace function public.can_manage_sensitive_employee_bank_data(target_company_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    or exists(
      select 1 from public.company_members m
      where m.company_id = target_company_id and m.profile_id = (select auth.uid()) and m.active
        and (m.ends_on is null or m.ends_on >= current_date)
        and m.company_role in ('company_admin', 'executive', 'accounting_hr')
    )
  )
$$;
revoke all on function public.can_manage_sensitive_employee_bank_data(uuid) from public, anon;
grant execute on function public.can_manage_sensitive_employee_bank_data(uuid) to authenticated;

create or replace function public.admin_upsert_employee_bank_account(
  target_profile_id uuid,
  target_bank_account_id uuid,
  target_bank_name text,
  full_account_number text,
  make_primary boolean,
  change_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  normalized_account text := regexp_replace(coalesce(full_account_number, ''), '[^0-9]', '', 'g');
  encryption_key text;
  fingerprint text;
  employee_name text;
  account_row public.master_bank_accounts%rowtype;
  duplicate_row public.master_bank_accounts%rowtype;
  previous_safe jsonb;
  should_be_primary boolean;
begin
  if not public.can_manage_sensitive_employee_bank_data(target_company_id) then raise exception 'คุณไม่มีสิทธิ์จัดการเลขบัญชีธนาคารพนักงาน'; end if;
  if normalized_account !~ '^[0-9]{8,20}$' then raise exception 'เลขบัญชีต้องมีตัวเลข 8-20 หลัก'; end if;
  if length(trim(coalesce(target_bank_name, ''))) < 2 then raise exception 'กรุณาระบุธนาคาร'; end if;
  if length(trim(coalesce(change_reason, ''))) < 3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if not exists(
    select 1 from public.company_members m where m.company_id = target_company_id and m.profile_id = target_profile_id
      and m.active and (m.ends_on is null or m.ends_on >= current_date)
  ) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;

  select decrypted_secret into encryption_key from vault.decrypted_secrets
  where name = 'employee_bank_account_encryption_key' order by updated_at desc limit 1;
  if encryption_key is null or length(encryption_key) < 32 then raise exception 'ระบบเข้ารหัสบัญชีธนาคารยังไม่พร้อม'; end if;
  fingerprint := encode(extensions.hmac(convert_to(normalized_account, 'utf8'), convert_to(encryption_key, 'utf8'), 'sha256'), 'hex');
  select coalesce(nullif(trim(p.full_name), ''), p.email) into employee_name from public.profiles p where p.id = target_profile_id;

  if target_bank_account_id is not null then
    select * into account_row from public.master_bank_accounts a
    where a.id = target_bank_account_id and a.company_id = target_company_id and (
      a.profile_id = target_profile_id or exists(
        select 1 from public.employee_people ep where ep.id = a.employee_person_id
          and ep.company_id = target_company_id and ep.profile_id = target_profile_id
      )
    ) for update;
    if account_row.id is null then raise exception 'ไม่พบบัญชีธนาคารของพนักงานรายนี้'; end if;
  end if;
  select * into duplicate_row from public.master_bank_accounts a
  where a.company_id = target_company_id and a.account_fingerprint = fingerprint
    and a.verification_status <> 'archived' and (account_row.id is null or a.id <> account_row.id) limit 1;
  if duplicate_row.id is not null then raise exception 'เลขบัญชีนี้มีอยู่ในบริษัทแล้ว กรุณาตรวจเจ้าของบัญชีก่อน'; end if;

  if account_row.id is not null and account_row.account_fingerprint = fingerprint
    and account_row.bank_name = trim(target_bank_name) and account_row.secure_number_available
    and (not make_primary or account_row.is_primary) then
    return jsonb_build_object('status', 'unchanged', 'bank_account_id', account_row.id, 'account_last4', account_row.account_last4);
  end if;
  previous_safe := case when account_row.id is null then null else jsonb_build_object(
    'bank_name', account_row.bank_name, 'account_last4', account_row.account_last4,
    'secure_number_available', account_row.secure_number_available, 'is_primary', account_row.is_primary
  ) end;
  should_be_primary := coalesce(make_primary, false) or not exists(
    select 1 from public.master_bank_accounts a where a.company_id = target_company_id
      and a.profile_id = target_profile_id and a.verification_status = 'verified' and a.is_primary
  );
  if should_be_primary then
    update public.master_bank_accounts set is_primary = false, updated_at = now()
    where company_id = target_company_id and profile_id = target_profile_id and is_primary;
  end if;

  if account_row.id is null then
    insert into public.master_bank_accounts(
      company_id, owner_type, owner_name, normalized_owner_name, profile_id, bank_name,
      account_last4, account_fingerprint, verification_status, secure_number_available,
      is_primary, verified_by, verified_at, created_by
    ) values (
      target_company_id, 'employee', employee_name, public.normalize_master_data_name(employee_name), target_profile_id,
      trim(target_bank_name), right(normalized_account, 4), fingerprint, 'verified', true,
      should_be_primary, (select auth.uid()), now(), (select auth.uid())
    ) returning * into account_row;
  else
    update public.master_bank_accounts set profile_id = target_profile_id, employee_person_id = null,
      bank_name = trim(target_bank_name), account_last4 = right(normalized_account, 4),
      account_fingerprint = fingerprint, verification_status = 'verified', secure_number_available = true,
      is_primary = should_be_primary or account_row.is_primary, verified_by = (select auth.uid()), verified_at = now(), updated_at = now()
    where id = account_row.id returning * into account_row;
  end if;

  insert into private.employee_bank_account_secrets(
    bank_account_id, company_id, encrypted_account_number, created_by, updated_by
  ) values (
    account_row.id, target_company_id,
    extensions.pgp_sym_encrypt(normalized_account, encryption_key, 'cipher-algo=aes256,compress-algo=0'),
    (select auth.uid()), (select auth.uid())
  ) on conflict(bank_account_id) do update set
    encrypted_account_number = excluded.encrypted_account_number, updated_by = excluded.updated_by, updated_at = now();

  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, old_values, new_values
  ) values (
    target_company_id, target_profile_id, (select auth.uid()), 'employee_bank_account', account_row.id,
    case when previous_safe is null then 'secure_bank_account_added' else 'secure_bank_account_updated' end,
    trim(change_reason), previous_safe,
    jsonb_build_object('bank_name', account_row.bank_name, 'account_last4', account_row.account_last4,
      'secure_number_available', true, 'is_primary', account_row.is_primary, 'source', 'employee_drawer')
  );
  return jsonb_build_object('status', case when previous_safe is null then 'created' else 'updated' end,
    'bank_account_id', account_row.id, 'account_last4', account_row.account_last4, 'is_primary', account_row.is_primary);
end $$;

create or replace function public.reveal_employee_bank_account_number(
  target_bank_account_id uuid,
  access_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  account_row public.master_bank_accounts%rowtype;
  secret_row private.employee_bank_account_secrets%rowtype;
  encryption_key text;
  account_number text;
  resolved_profile_id uuid;
begin
  if not public.can_manage_sensitive_employee_bank_data(target_company_id) then raise exception 'คุณไม่มีสิทธิ์เปิดดูเลขบัญชีเต็ม'; end if;
  if length(trim(coalesce(access_reason, ''))) < 3 then raise exception 'กรุณาระบุเหตุผลในการเปิดดู'; end if;
  select * into account_row from public.master_bank_accounts a
  where a.id = target_bank_account_id and a.company_id = target_company_id and a.verification_status = 'verified';
  if account_row.id is null or not exists(
    select 1 from public.company_members m where m.company_id = target_company_id and (
      m.profile_id = account_row.profile_id or exists(
        select 1 from public.employee_people ep where ep.id = account_row.employee_person_id
          and ep.company_id = target_company_id and ep.profile_id = m.profile_id
      )
    )
  ) then raise exception 'ไม่พบบัญชีธนาคารของพนักงานในบริษัทนี้'; end if;
  resolved_profile_id := account_row.profile_id;
  if resolved_profile_id is null then
    select ep.profile_id into resolved_profile_id from public.employee_people ep
    where ep.id = account_row.employee_person_id and ep.company_id = target_company_id;
  end if;
  select * into secret_row from private.employee_bank_account_secrets s
  where s.bank_account_id = account_row.id and s.company_id = target_company_id;
  if secret_row.bank_account_id is null then raise exception 'บัญชีนี้ยังไม่มีเลขเต็ม กรุณาเติมข้อมูลก่อน'; end if;
  select decrypted_secret into encryption_key from vault.decrypted_secrets
  where name = 'employee_bank_account_encryption_key' order by updated_at desc limit 1;
  account_number := extensions.pgp_sym_decrypt(secret_row.encrypted_account_number, encryption_key);
  insert into public.employee_workforce_audit_logs(
    company_id, profile_id, actor_profile_id, entity_type, entity_id, action, reason, new_values
  ) values (
    target_company_id, resolved_profile_id, (select auth.uid()), 'employee_bank_account', account_row.id,
    'full_bank_account_revealed', trim(access_reason),
    jsonb_build_object('bank_name', account_row.bank_name, 'account_last4', account_row.account_last4, 'source', 'employee_drawer')
  );
  return jsonb_build_object('bank_account_id', account_row.id, 'bank_name', account_row.bank_name,
    'full_account_number', account_number, 'account_last4', account_row.account_last4);
end $$;

revoke all on function public.admin_upsert_employee_bank_account(uuid,uuid,text,text,boolean,text) from public, anon;
revoke all on function public.reveal_employee_bank_account_number(uuid,text) from public, anon;
grant execute on function public.admin_upsert_employee_bank_account(uuid,uuid,text,text,boolean,text) to authenticated;
grant execute on function public.reveal_employee_bank_account_number(uuid,text) to authenticated;
notify pgrst, 'reload schema';
