-- Resolve both parties of an employee-advance slip from governed master data.
-- Preview is read-only. Apply is an Admin/manager confirmation action that
-- persists the holder alias, bank links and append-only workflow audit.

create table if not exists public.transfer_slip_advance_party_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  source_flow_item_id uuid not null references public.document_flow_items(id) on delete restrict,
  holder_id uuid not null references public.employee_advance_holders(id) on delete restrict,
  holder_profile_id uuid references public.profiles(id) on delete restrict,
  holder_person_id uuid references public.employee_people(id) on delete restrict,
  recipient_profile_id uuid not null references public.profiles(id) on delete restrict,
  sender_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  recipient_bank_account_id uuid references public.master_bank_accounts(id) on delete restrict,
  match_status text not null check (match_status in ('matched','needs_review','conflict')),
  match_reason text not null,
  event_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,financial_transaction_id),
  unique(company_id,event_key)
);

create index if not exists transfer_slip_advance_party_links_item_idx
  on public.transfer_slip_advance_party_links(company_id,source_flow_item_id,updated_at desc);

alter table public.transfer_slip_advance_party_links enable row level security;
revoke all on public.transfer_slip_advance_party_links from public,anon,authenticated;
grant select on public.transfer_slip_advance_party_links to authenticated;

drop policy if exists "Advance party links readable by authorised roles" on public.transfer_slip_advance_party_links;
create policy "Advance party links readable by authorised roles"
on public.transfer_slip_advance_party_links for select to authenticated using (
  public.is_platform_admin() or public.is_company_manager(company_id)
  or public.is_document_flow_department_member(company_id,'accounting')
  or public.is_document_flow_department_member(company_id,'hr')
);

create or replace function public.resolve_transfer_slip_advance_parties(
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
  holder_row public.employee_advance_holders;
  recipient_profile public.profiles;
  holder_count integer := 0;
  recipient_count integer := 0;
  holder_id_value uuid;
  recipient_profile_id_value uuid;
  sender_bank_row public.master_bank_accounts;
  recipient_bank_row public.master_bank_accounts;
  link_row public.transfer_slip_advance_party_links;
  sender_normalized text;
  recipient_normalized text;
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
  if coalesce(transaction_row.expense_type,'') <> 'advance' then
    return jsonb_build_object('applicable',false,'blockers',jsonb_build_array('ประเภทเงินไม่ใช่เงินเบิกล่วงหน้า'));
  end if;

  sender_normalized := public.normalize_employee_payment_name(transaction_row.sender_name);
  recipient_normalized := public.normalize_employee_payment_name(transaction_row.recipient_name);

  select count(*),(array_agg(candidate.id order by candidate.id))[1]
  into holder_count,holder_id_value
  from (
    select distinct holder.*
    from public.employee_advance_holders holder
    left join public.employee_advance_holder_aliases alias on alias.holder_id=holder.id
    where holder.company_id=item_row.company_id and holder.is_active and (
      public.normalize_employee_payment_name(holder.display_name)=sender_normalized
      or public.normalize_employee_payment_name(alias.alias_name)=sender_normalized
      or (length(sender_normalized)>=5 and public.normalize_employee_payment_name(holder.display_name) like sender_normalized || '%')
      or (length(public.normalize_employee_payment_name(holder.display_name))>=5 and sender_normalized like public.normalize_employee_payment_name(holder.display_name) || '%')
    )
  ) candidate;
  if holder_id_value is not null then select * into holder_row from public.employee_advance_holders where id=holder_id_value; end if;

  select count(*),(array_agg(profile.id order by profile.id))[1]
  into recipient_count,recipient_profile_id_value
  from (
    select distinct profile.*
    from public.profiles profile
    join public.employee_employment_records employment on employment.profile_id=profile.id
    left join public.employee_payment_name_aliases alias on alias.profile_id=profile.id and alias.company_id=employment.company_id
    where employment.company_id=item_row.company_id
      and employment.employment_type='daily'
      and employment.employment_status in ('active','probation','notice')
      and (public.normalize_employee_payment_name(profile.full_name)=recipient_normalized or alias.normalized_alias=recipient_normalized)
  ) profile;
  if recipient_profile_id_value is not null then select * into recipient_profile from public.profiles where id=recipient_profile_id_value; end if;

  if holder_count=0 then blockers:=array_append(blockers,'ไม่พบผู้โอนในทะเบียนผู้ถือเงินสำรองจ่าย');
  elsif holder_count>1 then blockers:=array_append(blockers,'พบผู้ถือเงินที่ตรงกันมากกว่าหนึ่งคน'); end if;
  if recipient_count=0 then blockers:=array_append(blockers,'ไม่พบผู้รับในทะเบียนพนักงานรายวัน');
  elsif recipient_count>1 then blockers:=array_append(blockers,'พบพนักงานผู้รับที่ตรงกันมากกว่าหนึ่งคน'); end if;
  if nullif(transaction_row.sender_account_last4,'') is null then blockers:=array_append(blockers,'ไม่มีเลขท้ายบัญชีผู้โอน'); end if;
  if nullif(transaction_row.recipient_account_last4,'') is null then blockers:=array_append(blockers,'ไม่มีเลขท้ายบัญชีผู้รับ'); end if;

  if cardinality(blockers)>0 or not target_apply then
    return jsonb_build_object(
      'applicable',true,'ready',cardinality(blockers)=0,'applied',false,'blockers',to_jsonb(blockers),
      'holder_count',holder_count,'holder_id',holder_row.id,'holder_name',holder_row.display_name,
      'recipient_count',recipient_count,'recipient_profile_id',recipient_profile.id,'recipient_name',recipient_profile.full_name,
      'sender_bank_linked',exists(select 1 from public.master_bank_accounts a where a.company_id=item_row.company_id and a.profile_id=holder_row.holder_profile_id and a.account_last4=transaction_row.sender_account_last4 and a.verification_status='verified'),
      'recipient_bank_linked',exists(select 1 from public.master_bank_accounts a where a.company_id=item_row.company_id and a.profile_id=recipient_profile.id and a.account_last4=transaction_row.recipient_account_last4 and a.verification_status='verified')
    );
  end if;

  if exists(select 1 from public.master_bank_accounts a where a.company_id=item_row.company_id and a.account_last4=transaction_row.sender_account_last4 and a.verification_status='verified' and a.profile_id is not null and a.profile_id<>holder_row.holder_profile_id)
  then raise exception 'sender_bank_account_owner_conflict'; end if;
  if exists(select 1 from public.master_bank_accounts a where a.company_id=item_row.company_id and a.account_last4=transaction_row.recipient_account_last4 and a.verification_status='verified' and a.profile_id is not null and a.profile_id<>recipient_profile.id)
  then raise exception 'recipient_bank_account_owner_conflict'; end if;

  select * into sender_bank_row from public.master_bank_accounts a
  where a.company_id=item_row.company_id and a.profile_id=holder_row.holder_profile_id
    and a.account_last4=transaction_row.sender_account_last4 and a.verification_status<>'archived'
  order by a.updated_at desc limit 1;
  if sender_bank_row.id is null then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,profile_id,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(item_row.company_id,'employee',holder_row.display_name,public.normalize_master_data_name(holder_row.display_name),holder_row.holder_profile_id,transaction_row.sender_bank_name,transaction_row.sender_account_last4,'verified','financial_transactions',transaction_row.id,auth.uid(),now(),auth.uid())
    returning * into sender_bank_row;
  end if;

  select * into recipient_bank_row from public.master_bank_accounts a
  where a.company_id=item_row.company_id and a.profile_id=recipient_profile.id
    and a.account_last4=transaction_row.recipient_account_last4 and a.verification_status<>'archived'
  order by a.updated_at desc limit 1;
  if recipient_bank_row.id is null then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,profile_id,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(item_row.company_id,'employee',recipient_profile.full_name,public.normalize_master_data_name(recipient_profile.full_name),recipient_profile.id,transaction_row.recipient_bank_name,transaction_row.recipient_account_last4,'verified','financial_transactions',transaction_row.id,auth.uid(),now(),auth.uid())
    returning * into recipient_bank_row;
  end if;

  insert into public.employee_advance_holder_aliases(holder_id,alias_name,created_by)
  values(holder_row.id,btrim(transaction_row.sender_name),auth.uid()) on conflict(holder_id,alias_name) do nothing;

  insert into public.transfer_slip_advance_party_links(company_id,financial_transaction_id,source_flow_item_id,holder_id,holder_profile_id,holder_person_id,recipient_profile_id,sender_bank_account_id,recipient_bank_account_id,match_status,match_reason,event_key,created_by)
  values(item_row.company_id,transaction_row.id,item_row.id,holder_row.id,holder_row.holder_profile_id,holder_row.holder_person_id,recipient_profile.id,sender_bank_row.id,recipient_bank_row.id,'matched','Admin ยืนยันสลิป; ระบบจับคู่ผู้ถือเงินและพนักงานได้ด้านละหนึ่งรายการ',target_event_key,auth.uid())
  on conflict(company_id,financial_transaction_id) do update set
    holder_id=excluded.holder_id,holder_profile_id=excluded.holder_profile_id,holder_person_id=excluded.holder_person_id,
    recipient_profile_id=excluded.recipient_profile_id,sender_bank_account_id=excluded.sender_bank_account_id,
    recipient_bank_account_id=excluded.recipient_bank_account_id,match_status='matched',match_reason=excluded.match_reason,
    event_key=excluded.event_key,updated_at=now()
  returning * into link_row;

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key,'transfer_slip_advance_parties_linked',item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,
    'เชื่อมผู้โอนกับทะเบียนผู้ถือเงิน และเชื่อมบัญชีผู้รับกับพนักงาน ก่อนดำเนิน Flow เงินเบิกล่วงหน้า',
    jsonb_build_object('party_link_id',link_row.id,'holder_id',holder_row.id,'holder_profile_id',holder_row.holder_profile_id,'recipient_profile_id',recipient_profile.id,'sender_bank_account_id',sender_bank_row.id,'recipient_bank_account_id',recipient_bank_row.id,'transaction_id',transaction_row.id),auth.uid())
  on conflict(event_key) do nothing;

  return jsonb_build_object('applicable',true,'ready',true,'applied',true,'blockers','[]'::jsonb,
    'party_link_id',link_row.id,'holder_id',holder_row.id,'holder_name',holder_row.display_name,
    'recipient_profile_id',recipient_profile.id,'recipient_name',recipient_profile.full_name,
    'sender_bank_account_id',sender_bank_row.id,'recipient_bank_account_id',recipient_bank_row.id,
    'sender_bank_linked',true,'recipient_bank_linked',true);
end;
$$;

revoke all on function public.resolve_transfer_slip_advance_parties(uuid,text,boolean) from public,anon;
grant execute on function public.resolve_transfer_slip_advance_parties(uuid,text,boolean) to authenticated;

notify pgrst,'reload schema';

-- Rollback: revoke the RPC and hide the UI helper. Preserve party links,
-- bank facts, aliases and workflow audit so already-confirmed slips remain traceable.
