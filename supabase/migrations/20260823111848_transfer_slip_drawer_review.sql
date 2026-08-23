-- Atomic Admin review for one transfer slip. Raw LINE source and routing remain unchanged.
create or replace function public.review_transfer_slip_details(
  target_item_id uuid,
  target_event_key text,
  target_decision text,
  target_sender_name text default null,
  target_sender_bank_name text default null,
  target_sender_account_last4 text default null,
  target_recipient_name text default null,
  target_recipient_bank_name text default null,
  target_recipient_account_last4 text default null,
  target_amount_total numeric default null,
  target_transfer_at timestamptz default null,
  target_bank_reference text default null,
  target_note text default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  item_row public.document_flow_items;
  before_tx public.financial_transactions;
  after_tx public.financial_transactions;
  next_review text;
  next_data_status text;
  missing_fields text[] := '{}';
  changed_fields text[] := '{}';
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if coalesce(btrim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  if target_decision not in ('draft','confirm','request_information') then raise exception 'transfer_slip_review_decision_invalid'; end if;
  if exists(select 1 from public.document_flow_events where event_key=target_event_key) then
    return (select payload from public.document_flow_events where event_key=target_event_key limit 1);
  end if;

  select * into item_row from public.document_flow_items where id=target_item_id for update;
  if item_row.id is null or item_row.document_type<>'transfer_slip' then raise exception 'transfer_slip_item_not_found'; end if;
  if item_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id) then raise exception 'workflow_permission_denied'; end if;

  select * into before_tx from public.financial_transactions where source_message_id=item_row.source_message_id for update;
  if before_tx.id is null then raise exception 'transfer_slip_transaction_not_found'; end if;
  if before_tx.review_status in ('duplicate','dismissed') then raise exception 'transfer_slip_review_locked'; end if;
  if nullif(target_sender_account_last4,'') is not null and target_sender_account_last4 !~ '^[0-9]{4}$' then raise exception 'sender_account_last4_invalid'; end if;
  if nullif(target_recipient_account_last4,'') is not null and target_recipient_account_last4 !~ '^[0-9]{4}$' then raise exception 'recipient_account_last4_invalid'; end if;
  if target_amount_total is not null and target_amount_total<0 then raise exception 'transfer_slip_amount_invalid'; end if;

  if nullif(btrim(target_sender_name),'') is null then missing_fields:=array_append(missing_fields,'sender_name'); end if;
  if nullif(btrim(target_recipient_name),'') is null then missing_fields:=array_append(missing_fields,'recipient_name'); end if;
  if target_amount_total is null then missing_fields:=array_append(missing_fields,'amount_total'); end if;
  if target_transfer_at is null then missing_fields:=array_append(missing_fields,'transfer_at'); end if;
  if target_decision='confirm' and cardinality(missing_fields)>0 then raise exception 'transfer_slip_required_fields_missing:%',array_to_string(missing_fields,','); end if;
  if target_decision='request_information' and coalesce(btrim(target_note),'')='' then raise exception 'workflow_data_review_note_required'; end if;

  if before_tx.sender_name is distinct from nullif(btrim(target_sender_name),'') then changed_fields:=array_append(changed_fields,'sender_name'); end if;
  if before_tx.sender_bank_name is distinct from nullif(btrim(target_sender_bank_name),'') then changed_fields:=array_append(changed_fields,'sender_bank_name'); end if;
  if before_tx.sender_account_last4 is distinct from nullif(target_sender_account_last4,'') then changed_fields:=array_append(changed_fields,'sender_account_last4'); end if;
  if before_tx.recipient_name is distinct from nullif(btrim(target_recipient_name),'') then changed_fields:=array_append(changed_fields,'recipient_name'); end if;
  if before_tx.recipient_bank_name is distinct from nullif(btrim(target_recipient_bank_name),'') then changed_fields:=array_append(changed_fields,'recipient_bank_name'); end if;
  if before_tx.recipient_account_last4 is distinct from nullif(target_recipient_account_last4,'') then changed_fields:=array_append(changed_fields,'recipient_account_last4'); end if;
  if before_tx.amount_total is distinct from target_amount_total then changed_fields:=array_append(changed_fields,'amount_total'); end if;
  if before_tx.transfer_at is distinct from target_transfer_at then changed_fields:=array_append(changed_fields,'transfer_at'); end if;
  if before_tx.bank_reference is distinct from nullif(btrim(target_bank_reference),'') then changed_fields:=array_append(changed_fields,'bank_reference'); end if;

  next_review:=case when target_decision='confirm' then 'confirmed' else 'pending' end;
  next_data_status:=case when target_decision='confirm' then 'rechecked' when target_decision='request_information' then 'incomplete' else case when cardinality(missing_fields)>0 then 'incomplete' else 'recheck_required' end end;
  update public.financial_transactions set
    sender_name=nullif(btrim(target_sender_name),''),sender_bank_name=nullif(btrim(target_sender_bank_name),''),sender_account_last4=nullif(target_sender_account_last4,''),
    recipient_name=nullif(btrim(target_recipient_name),''),recipient_bank_name=nullif(btrim(target_recipient_bank_name),''),recipient_account_last4=nullif(target_recipient_account_last4,''),
    amount_total=target_amount_total,transfer_at=target_transfer_at,bank_reference=nullif(btrim(target_bank_reference),''),notes=nullif(btrim(target_note),''),
    review_status=next_review,reviewed_by=case when target_decision='confirm' then auth.uid() else reviewed_by end,reviewed_at=case when target_decision='confirm' then now() else reviewed_at end,updated_at=now()
  where id=before_tx.id returning * into after_tx;

  update public.document_flow_items set data_review_status=next_data_status,data_review_note=nullif(btrim(target_note),''),data_review_changed_fields=to_jsonb(changed_fields),data_reviewed_at=now(),data_reviewed_by=auth.uid(),version=version+1,updated_at=now() where id=item_row.id;
  update public.document_flow_destination_tasks set status=case when target_decision='confirm' then status else 'recheck_required' end,note=coalesce(nullif(btrim(target_note),''),note),version=version+1,updated_at=now() where item_id=item_row.id and department='accounting' and status not in ('completed','cancelled');

  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(item_row.id,item_row.company_id,target_event_key,'transfer_slip_review_'||target_decision,item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,item_row.current_room,item_row.current_room,target_note,
    jsonb_build_object('decision',target_decision,'changed_fields',changed_fields,'missing_fields',missing_fields,'transaction_id',after_tx.id,'before',jsonb_build_object('sender_name',before_tx.sender_name,'recipient_name',before_tx.recipient_name,'amount_total',before_tx.amount_total,'transfer_at',before_tx.transfer_at,'bank_reference',before_tx.bank_reference),'after',jsonb_build_object('sender_name',after_tx.sender_name,'recipient_name',after_tx.recipient_name,'amount_total',after_tx.amount_total,'transfer_at',after_tx.transfer_at,'bank_reference',after_tx.bank_reference)),auth.uid());
  return jsonb_build_object('item_id',item_row.id,'transaction_id',after_tx.id,'decision',target_decision,'changed_fields',changed_fields,'missing_fields',missing_fields,'review_status',after_tx.review_status,'data_review_status',next_data_status);
end; $$;

revoke all on function public.review_transfer_slip_details(uuid,text,text,text,text,text,text,text,text,numeric,timestamptz,text,text) from public,anon;
grant execute on function public.review_transfer_slip_details(uuid,text,text,text,text,text,text,text,text,numeric,timestamptz,text,text) to authenticated;
notify pgrst,'reload schema';
