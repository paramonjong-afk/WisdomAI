-- Reconcile legacy verified bank-account rows that predate fingerprints.
-- Keep one active Canonical ID, repoint operational projections, archive (never
-- delete) exact duplicates, and make future confirmed-slip sync reuse them.

do $$
declare
  duplicate_group record;
  survivor_id uuid;
  duplicate_id uuid;
  survivor_fingerprint text;
begin
  for duplicate_group in
    select account.company_id,account.normalized_owner_name,
           public.normalize_master_data_bank(account.bank_name) normalized_bank,
           account.account_last4
    from public.master_bank_accounts account
    where account.verification_status <> 'archived'
    group by account.company_id,account.normalized_owner_name,
             public.normalize_master_data_bank(account.bank_name),account.account_last4
    having count(*) > 1
  loop
    select account.id,coalesce(account.account_fingerprint,
      md5(account.company_id::text || '|' || account.normalized_owner_name || '|' || account.account_last4))
    into survivor_id,survivor_fingerprint
    from public.master_bank_accounts account
    where account.company_id = duplicate_group.company_id
      and account.normalized_owner_name = duplicate_group.normalized_owner_name
      and public.normalize_master_data_bank(account.bank_name) is not distinct from duplicate_group.normalized_bank
      and account.account_last4 = duplicate_group.account_last4
      and account.verification_status <> 'archived'
    order by (account.account_fingerprint is not null) desc,
             exists(select 1 from private.employee_bank_account_secrets secret where secret.bank_account_id=account.id) desc,
             account.created_at,account.id
    limit 1;

    for duplicate_id in
      select account.id from public.master_bank_accounts account
      where account.company_id = duplicate_group.company_id
        and account.normalized_owner_name = duplicate_group.normalized_owner_name
        and public.normalize_master_data_bank(account.bank_name) is not distinct from duplicate_group.normalized_bank
        and account.account_last4 = duplicate_group.account_last4
        and account.verification_status <> 'archived'
        and account.id <> survivor_id
      order by account.created_at,account.id
    loop
      if exists(select 1 from private.employee_bank_account_secrets secret where secret.bank_account_id=duplicate_id) then
        raise exception 'canonical_duplicate_with_secure_secret_requires_manual_review:%',duplicate_id;
      end if;

      update public.master_data_transfer_party_reviews
      set sender_master_bank_account_id = survivor_id,updated_at=now()
      where sender_master_bank_account_id = duplicate_id;
      update public.master_data_transfer_party_reviews
      set recipient_master_bank_account_id = survivor_id,updated_at=now()
      where recipient_master_bank_account_id = duplicate_id;
      update public.transfer_slip_advance_party_links
      set sender_bank_account_id = survivor_id,updated_at=now()
      where sender_bank_account_id = duplicate_id;
      update public.transfer_slip_advance_party_links
      set recipient_bank_account_id = survivor_id,updated_at=now()
      where recipient_bank_account_id = duplicate_id;

      update public.master_data_candidates
      set candidate_data = jsonb_set(candidate_data,'{canonical_bank_account_id}',to_jsonb(survivor_id),true),
          updated_at=now()
      where candidate_data->>'canonical_bank_account_id' = duplicate_id::text;

      update public.master_bank_accounts
      set verification_status='archived',archived_at=now(),updated_at=now()
      where id=duplicate_id;

      insert into public.master_data_audit(
        company_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason
      ) values (
        duplicate_group.company_id,survivor_id,
        'canonical-bank-account-duplicate-archived:' || duplicate_id::text,
        'canonical_bank_account_duplicate_archived',null,
        jsonb_build_object('duplicate_bank_account_id',duplicate_id),
        jsonb_build_object('canonical_bank_account_id',survivor_id,'duplicate_status','archived'),
        'รวมข้อมูลหลักที่ชื่อ ธนาคาร และเลขท้ายบัญชีตรงครบ โดยย้าย operational reference และไม่ลบประวัติ'
      ) on conflict(event_key) do nothing;
    end loop;

    update public.master_bank_accounts
    set account_fingerprint=survivor_fingerprint,updated_at=now()
    where id=survivor_id and account_fingerprint is null;
  end loop;
end;
$$;

do $$
declare
  function_sql text;
  old_block text := $block$
  select * into canonical_row
  from public.master_bank_accounts account
  where account.company_id = lineage_row.company_id
    and account.account_fingerprint = fingerprint_value
    and account.verification_status <> 'archived'
  for update;

  if canonical_row.id is not null
$block$;
  new_block text := $block$
  select * into canonical_row
  from public.master_bank_accounts account
  where account.company_id = lineage_row.company_id
    and account.account_fingerprint = fingerprint_value
    and account.verification_status <> 'archived'
  for update;

  if canonical_row.id is null then
    select * into canonical_row
    from public.master_bank_accounts account
    where account.company_id = lineage_row.company_id
      and account.normalized_owner_name = normalized_name_value
      and account.account_last4 = account_value
      and public.normalize_master_data_bank(account.bank_name) = normalized_bank_value
      and account.verification_status <> 'archived'
    order by account.created_at,account.id
    limit 1
    for update;
    if canonical_row.id is not null and canonical_row.account_fingerprint is null then
      update public.master_bank_accounts
      set account_fingerprint=fingerprint_value,updated_at=now()
      where id=canonical_row.id
      returning * into canonical_row;
    end if;
  end if;

  if canonical_row.id is not null
$block$;
begin
  select pg_get_functiondef(procedure.oid) into function_sql
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='public'
    and procedure.proname='sync_confirmed_transfer_party_to_canonical_master'
    and pg_get_function_identity_arguments(procedure.oid)=
      'target_lineage_id uuid, target_party_role text, target_name text, target_bank_name text, target_account_last4 text, target_actor_id uuid, target_confirmed_at timestamp with time zone';
  if function_sql is null then raise exception 'confirmed_transfer_canonical_sync_function_not_found'; end if;
  function_sql := replace(function_sql,chr(13)||chr(10),chr(10));
  if position(old_block in function_sql)=0 then raise exception 'confirmed_transfer_canonical_lookup_block_not_found'; end if;
  execute replace(function_sql,old_block,new_block);
end;
$$;

revoke all on function public.sync_confirmed_transfer_party_to_canonical_master(uuid,text,text,text,text,uuid,timestamptz)
  from public,anon,authenticated;

notify pgrst, 'reload schema';
