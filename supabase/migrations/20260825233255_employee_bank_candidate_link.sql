-- Let authorised HR/finance users reuse a verified bank fact already captured by Master Data.
create or replace function public.list_employee_bank_account_candidates(target_profile_id uuid)
returns table(id uuid, owner_name text, bank_name text, account_last4 text, verification_status text, secure_number_available boolean, is_primary boolean, evidence_source_table text, evidence_source_id uuid, verified_at timestamptz, link_status text)
language plpgsql security definer set search_path = '' as $$
declare target_company_id uuid := public.current_company_id(); target_name text; target_normalized_name text;
begin
  if not public.can_manage_sensitive_employee_bank_data(target_company_id) then raise exception 'คุณไม่มีสิทธิ์ดู Candidate บัญชีธนาคารพนักงาน'; end if;
  if not exists(select 1 from public.company_members member where member.company_id=target_company_id and member.profile_id=target_profile_id and member.active and (member.ends_on is null or member.ends_on>=current_date)) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;
  select coalesce(nullif(trim(profile.full_name),''),profile.email) into target_name from public.profiles profile where profile.id=target_profile_id;
  target_normalized_name := public.normalize_master_data_name(target_name);
  return query select account.id,account.owner_name,account.bank_name,account.account_last4,account.verification_status,account.secure_number_available,account.is_primary,account.evidence_source_table,account.evidence_source_id,account.verified_at,
    case when account.profile_id=target_profile_id then 'linked_same' when account.profile_id is not null or account.employee_person_id is not null then 'linked_other' else 'available' end
  from public.master_bank_accounts account
  where account.company_id=target_company_id and account.verification_status<>'archived' and account.normalized_owner_name=target_normalized_name
  order by case when account.profile_id=target_profile_id then 0 when account.profile_id is null and account.employee_person_id is null then 1 else 2 end,account.verified_at desc nulls last,account.updated_at desc;
end $$;
create or replace function public.admin_link_employee_bank_account_candidate(target_profile_id uuid,target_bank_account_id uuid,make_primary boolean,link_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_company_id uuid := public.current_company_id(); employee_name text; employee_normalized_name text; account_row public.master_bank_accounts%rowtype; should_be_primary boolean;
begin
  if not public.can_manage_sensitive_employee_bank_data(target_company_id) then raise exception 'คุณไม่มีสิทธิ์ผูกบัญชีธนาคารพนักงาน'; end if;
  if length(trim(coalesce(link_reason,'')))<3 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร'; end if;
  if not exists(select 1 from public.company_members member where member.company_id=target_company_id and member.profile_id=target_profile_id and member.active and (member.ends_on is null or member.ends_on>=current_date)) then raise exception 'ไม่พบพนักงานในบริษัทปัจจุบัน'; end if;
  select coalesce(nullif(trim(profile.full_name),''),profile.email) into employee_name from public.profiles profile where profile.id=target_profile_id;
  employee_normalized_name := public.normalize_master_data_name(employee_name);
  select * into account_row from public.master_bank_accounts account where account.id=target_bank_account_id and account.company_id=target_company_id and account.verification_status<>'archived' for update;
  if account_row.id is null then raise exception 'ไม่พบบัญชี Candidate ในบริษัทปัจจุบัน'; end if;
  if account_row.normalized_owner_name<>employee_normalized_name then raise exception 'ชื่อเจ้าของบัญชีไม่ตรงกับพนักงาน กรุณาตรวจหลักฐานหรือกรอกบัญชีใหม่'; end if;
  if account_row.profile_id=target_profile_id then return jsonb_build_object('status','unchanged','bank_account_id',account_row.id,'account_last4',account_row.account_last4,'secure_number_available',account_row.secure_number_available); end if;
  if account_row.profile_id is not null or account_row.employee_person_id is not null then raise exception 'บัญชี Candidate นี้ถูกผูกกับบุคคลอื่นแล้ว'; end if;
  should_be_primary := coalesce(make_primary,false) or not exists(select 1 from public.master_bank_accounts existing where existing.company_id=target_company_id and existing.profile_id=target_profile_id and existing.verification_status='verified' and existing.is_primary);
  if should_be_primary then update public.master_bank_accounts set is_primary=false,updated_at=now() where company_id=target_company_id and profile_id=target_profile_id and is_primary; end if;
  update public.master_bank_accounts set owner_type='employee',owner_name=employee_name,normalized_owner_name=employee_normalized_name,profile_id=target_profile_id,employee_person_id=null,is_primary=should_be_primary,updated_at=now() where id=account_row.id returning * into account_row;
  insert into public.employee_workforce_audit_logs(company_id,profile_id,actor_profile_id,entity_type,entity_id,action,reason,new_values)
  values(target_company_id,target_profile_id,(select auth.uid()),'employee_bank_account',account_row.id,'existing_bank_candidate_linked',trim(link_reason),jsonb_build_object('bank_name',account_row.bank_name,'account_last4',account_row.account_last4,'secure_number_available',account_row.secure_number_available,'is_primary',account_row.is_primary,'source',account_row.evidence_source_table,'source_id',account_row.evidence_source_id));
  return jsonb_build_object('status','linked','bank_account_id',account_row.id,'account_last4',account_row.account_last4,'secure_number_available',account_row.secure_number_available,'is_primary',account_row.is_primary);
end $$;
revoke all on function public.list_employee_bank_account_candidates(uuid) from public,anon;
revoke all on function public.admin_link_employee_bank_account_candidate(uuid,uuid,boolean,text) from public,anon;
grant execute on function public.list_employee_bank_account_candidates(uuid) to authenticated;
grant execute on function public.admin_link_employee_bank_account_candidate(uuid,uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';;
