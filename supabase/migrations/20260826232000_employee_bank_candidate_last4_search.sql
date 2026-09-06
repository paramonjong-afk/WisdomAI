create or replace function public.search_employee_bank_account_candidates(
  target_profile_id uuid,
  target_account_last4 text
)
returns table(
  id uuid, owner_name text, bank_name text, account_last4 text,
  verification_status text, secure_number_available boolean, is_primary boolean,
  evidence_source_table text, evidence_source_id uuid, verified_at timestamptz, link_status text
) language plpgsql security definer set search_path = '' as $$
declare
  target_company_id uuid := public.current_company_id();
  target_name text;
  target_normalized_name text;
  normalized_last4 text := regexp_replace(coalesce(target_account_last4, ''), '[^0-9]', '', 'g');
begin
  if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบ'; end if;
  if not public.can_manage_sensitive_employee_bank_data(target_company_id) then
    raise exception 'คุณไม่มีสิทธิ์ค้นหาบัญชีธนาคารพนักงาน';
  end if;
  if length(normalized_last4) <> 4 then raise exception 'กรุณาระบุเลขท้ายบัญชี 4 หลัก'; end if;
  if not exists(
    select 1 from public.company_members member
    where member.company_id = target_company_id and member.profile_id = target_profile_id
      and member.active and (member.ends_on is null or member.ends_on >= current_date)
  ) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;

  select coalesce(nullif(trim(profile.full_name), ''), profile.email)
    into target_name from public.profiles profile where profile.id = target_profile_id;
  target_normalized_name := public.normalize_master_data_name(target_name);

  return query
  select account.id, account.owner_name, account.bank_name, account.account_last4,
    account.verification_status, account.secure_number_available, account.is_primary,
    account.evidence_source_table, account.evidence_source_id, account.verified_at,
    case when account.profile_id = target_profile_id then 'linked_same'
      when account.profile_id is not null or account.employee_person_id is not null then 'linked_other'
      when account.normalized_owner_name <> target_normalized_name then 'name_mismatch'
      else 'available' end
  from public.master_bank_accounts account
  where account.company_id = target_company_id
    and account.verification_status <> 'archived'
    and account.account_last4 = normalized_last4
  order by case when account.profile_id = target_profile_id then 0
      when account.normalized_owner_name = target_normalized_name and account.profile_id is null and account.employee_person_id is null then 1
      when account.profile_id is null and account.employee_person_id is null then 2 else 3 end,
    account.verified_at desc nulls last, account.updated_at desc;
end $$;

revoke all on function public.search_employee_bank_account_candidates(uuid,text) from public, anon;
grant execute on function public.search_employee_bank_account_candidates(uuid,text) to authenticated;
notify pgrst, 'reload schema';
