-- Separate a new/top-up holder fund from the legacy holder-to-daily-worker gate.
-- Source payer remains evidence; the destination holder and receiving account
-- are the canonical operational parties for a starting fund.

create or replace function public.resolve_transfer_slip_starting_fund_parties_v1(
  target_item_id uuid,
  target_event_key text,
  target_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.document_flow_items;
  transaction_row public.financial_transactions;
  lineage_row public.transfer_slip_money_lineages;
  holder_row public.employee_advance_holders;
  recipient_profile public.profiles;
  recipient_bank_row public.master_bank_accounts;
  sender_bank_row public.master_bank_accounts;
  link_row public.transfer_slip_advance_party_links;
  recipient_normalized text;
  holder_count integer := 0;
  holder_id_value uuid;
  blockers text[] := '{}';
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'workflow_event_key_required'; end if;

  select * into item_row from public.document_flow_items where id=target_item_id;
  if item_row.id is null then raise exception 'document_flow_item_not_found'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id)
    and not public.is_document_flow_department_member(item_row.company_id,'accounting')
  then raise exception 'workflow_permission_denied'; end if;

  select * into transaction_row from public.financial_transactions
  where source_message_id=item_row.source_message_id and review_status not in ('duplicate','dismissed')
  order by created_at desc limit 1;
  if transaction_row.id is null then raise exception 'financial_transaction_not_found'; end if;

  select * into lineage_row from public.transfer_slip_money_lineages
  where item_id=item_row.id order by updated_at desc limit 1;
  if lineage_row.id is null then raise exception 'money_lineage_not_found'; end if;
  if lineage_row.funding_source_type not in ('company_account','personal_reimbursement') then
    raise exception 'starting_fund_source_type_required';
  end if;
  if not exists (
    select 1 from public.transfer_slip_money_allocations allocation
    where allocation.lineage_id=lineage_row.id and allocation.status<>'superseded'
      and allocation.purpose_type='advance_transfer'
  ) then raise exception 'starting_fund_allocation_required'; end if;

  recipient_normalized := public.normalize_employee_payment_name(transaction_row.recipient_name);
  select count(*),(array_agg(candidate.id order by candidate.id))[1]
  into holder_count,holder_id_value
  from (
    select distinct holder.id
    from public.employee_advance_holders holder
    left join public.employee_advance_holder_aliases alias on alias.holder_id=holder.id
    where holder.company_id=item_row.company_id and holder.is_active and (
      public.normalize_employee_payment_name(holder.display_name)=recipient_normalized
      or public.normalize_employee_payment_name(alias.alias_name)=recipient_normalized
      or (length(recipient_normalized)>=5 and public.normalize_employee_payment_name(holder.display_name) like recipient_normalized || '%')
      or (length(public.normalize_employee_payment_name(holder.display_name))>=5 and recipient_normalized like public.normalize_employee_payment_name(holder.display_name) || '%')
    )
  ) candidate;
  if holder_id_value is not null then
    select * into holder_row from public.employee_advance_holders where id=holder_id_value;
  end if;

  if holder_count=0 then blockers:=array_append(blockers,'ไม่พบผู้รับในทะเบียนผู้ถือเงินสำรองจ่าย');
  elsif holder_count>1 then blockers:=array_append(blockers,'พบผู้ถือเงินผู้รับที่ตรงกันมากกว่าหนึ่งคน'); end if;
  if holder_count=1 and holder_row.holder_profile_id is null then blockers:=array_append(blockers,'ผู้ถือเงินผู้รับยังไม่เชื่อมบัญชีผู้ใช้พนักงาน'); end if;
  if nullif(transaction_row.recipient_account_last4,'') is null then blockers:=array_append(blockers,'ไม่มีเลขท้ายบัญชีผู้รับ'); end if;

  if holder_row.holder_profile_id is not null then
    select * into recipient_profile from public.profiles where id=holder_row.holder_profile_id;
  end if;

  if cardinality(blockers)>0 or not target_apply then
    return jsonb_build_object(
      'applicable',true,'starting_fund',true,'ready',cardinality(blockers)=0,'applied',false,
      'blockers',to_jsonb(blockers),'holder_count',holder_count,'holder_id',holder_row.id,
      'holder_name',holder_row.display_name,'recipient_profile_id',recipient_profile.id,
      'recipient_name',holder_row.display_name,'sender_bank_linked',false,
      'recipient_bank_linked',exists(select 1 from public.master_bank_accounts account where account.company_id=item_row.company_id and account.profile_id=holder_row.holder_profile_id and account.account_last4=transaction_row.recipient_account_last4 and account.verification_status='verified')
    );
  end if;

  if exists(select 1 from public.master_bank_accounts account
    where account.company_id=item_row.company_id and account.account_last4=transaction_row.recipient_account_last4
      and account.verification_status='verified' and account.profile_id is not null
      and account.profile_id<>holder_row.holder_profile_id)
  then raise exception 'recipient_bank_account_owner_conflict'; end if;

  select * into recipient_bank_row from public.master_bank_accounts account
  where account.company_id=item_row.company_id and account.profile_id=holder_row.holder_profile_id
    and account.account_last4=transaction_row.recipient_account_last4 and account.verification_status<>'archived'
  order by account.updated_at desc limit 1;
  if recipient_bank_row.id is null then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,profile_id,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(item_row.company_id,'employee',holder_row.display_name,public.normalize_master_data_name(holder_row.display_name),holder_row.holder_profile_id,transaction_row.recipient_bank_name,transaction_row.recipient_account_last4,'verified','financial_transactions',transaction_row.id,auth.uid(),now(),auth.uid())
    returning * into recipient_bank_row;
  elsif recipient_bank_row.verification_status<>'verified' then
    update public.master_bank_accounts set verification_status='verified',verified_by=auth.uid(),verified_at=now(),updated_at=now()
    where id=recipient_bank_row.id returning * into recipient_bank_row;
  end if;

  select * into sender_bank_row from public.master_bank_accounts account
  where account.company_id=item_row.company_id
    and account.account_last4=transaction_row.sender_account_last4
    and public.normalize_master_data_name(account.owner_name)=public.normalize_master_data_name(transaction_row.sender_name)
    and account.verification_status='verified'
  order by account.updated_at desc limit 1;

  insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by)
  values(holder_row.id,btrim(transaction_row.recipient_name),auth.uid())
  on conflict(holder_id,alias_name) do nothing;

  insert into public.transfer_slip_advance_party_links(company_id,financial_transaction_id,source_flow_item_id,holder_id,holder_profile_id,holder_person_id,recipient_profile_id,sender_bank_account_id,recipient_bank_account_id,match_status,match_reason,event_key,created_by)
  values(item_row.company_id,transaction_row.id,item_row.id,holder_row.id,holder_row.holder_profile_id,holder_row.holder_person_id,recipient_profile.id,sender_bank_row.id,recipient_bank_row.id,'matched','Admin ยืนยันเงินตั้งต้นกอง; ผู้โอนเป็น Source of Funds และผู้รับตรงทะเบียนผู้ถือเงิน',target_event_key,auth.uid())
  on conflict(company_id,financial_transaction_id) do update set
    holder_id=excluded.holder_id,holder_profile_id=excluded.holder_profile_id,holder_person_id=excluded.holder_person_id,
    recipient_profile_id=excluded.recipient_profile_id,sender_bank_account_id=excluded.sender_bank_account_id,
    recipient_bank_account_id=excluded.recipient_bank_account_id,match_status='matched',match_reason=excluded.match_reason,
    event_key=excluded.event_key,updated_at=now()
  returning * into link_row;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key,'transfer_slip_starting_fund_holder_linked',item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,
    'เชื่อมผู้รับกับทะเบียนผู้ถือเงินสำหรับเงินตั้งต้น/เติมกอง โดยเก็บผู้โอนเป็นหลักฐานต้นทาง',
    jsonb_build_object('party_link_id',link_row.id,'holder_id',holder_row.id,'recipient_profile_id',recipient_profile.id,'sender_name',transaction_row.sender_name,'sender_bank_account_id',sender_bank_row.id,'recipient_bank_account_id',recipient_bank_row.id,'transaction_id',transaction_row.id,'lineage_id',lineage_row.id),auth.uid())
  on conflict(event_key) do nothing;

  return jsonb_build_object('applicable',true,'starting_fund',true,'ready',true,'applied',true,'blockers','[]'::jsonb,
    'party_link_id',link_row.id,'holder_id',holder_row.id,'holder_name',holder_row.display_name,
    'recipient_profile_id',recipient_profile.id,'recipient_name',holder_row.display_name,
    'sender_bank_account_id',sender_bank_row.id,'recipient_bank_account_id',recipient_bank_row.id,
    'sender_bank_linked',sender_bank_row.id is not null,'recipient_bank_linked',true);
end;
$$;

revoke all on function public.resolve_transfer_slip_starting_fund_parties_v1(uuid,text,boolean) from public,anon;
grant execute on function public.resolve_transfer_slip_starting_fund_parties_v1(uuid,text,boolean) to authenticated;

notify pgrst,'reload schema';

-- Rollback: revoke the v1 RPC and route starting funds back to manual review.
-- Preserve source transactions, holder links, verified bank facts and Audit.
