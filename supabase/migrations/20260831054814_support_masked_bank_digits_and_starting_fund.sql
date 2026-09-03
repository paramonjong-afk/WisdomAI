-- Bangkok Bank and some other banks expose only three trailing account digits
-- on transfer evidence. Preserve exactly what is visible; never fabricate a
-- fourth digit. The legacy column names remain for API compatibility.

alter table public.financial_transactions
  drop constraint if exists financial_transactions_sender_account_last4_check,
  drop constraint if exists financial_transactions_recipient_account_last4_check;
alter table public.financial_transactions
  add constraint financial_transactions_sender_account_last4_check
    check (sender_account_last4 is null or sender_account_last4 ~ '^[0-9]{3,4}$'),
  add constraint financial_transactions_recipient_account_last4_check
    check (recipient_account_last4 is null or recipient_account_last4 ~ '^[0-9]{3,4}$');

comment on column public.financial_transactions.sender_account_last4 is
  'Trailing 3 or 4 digits exactly as visibly masked on source evidence; never inferred.';
comment on column public.financial_transactions.recipient_account_last4 is
  'Trailing 3 or 4 digits exactly as visibly masked on destination evidence; never inferred.';

alter table public.financial_transaction_account_pairs
  drop constraint if exists financial_transaction_account_pairs_sender_account_last4_check,
  drop constraint if exists financial_transaction_account_pairs_recipient_account_last4_check;
alter table public.financial_transaction_account_pairs
  add constraint financial_transaction_account_pairs_sender_account_last4_check
    check (sender_account_last4 ~ '^[0-9]{3,4}$'),
  add constraint financial_transaction_account_pairs_recipient_account_last4_check
    check (recipient_account_last4 ~ '^[0-9]{3,4}$');

alter table public.master_data_transfer_party_reviews
  drop constraint if exists master_data_transfer_party_reviews_sender_account_last4_check,
  drop constraint if exists master_data_transfer_party_reviews_recipient_account_last4_check;
alter table public.master_data_transfer_party_reviews
  add constraint master_data_transfer_party_reviews_sender_account_last4_check
    check (sender_account_last4 ~ '^[0-9]{3,4}$'),
  add constraint master_data_transfer_party_reviews_recipient_account_last4_check
    check (recipient_account_last4 ~ '^[0-9]{3,4}$');

-- Patch the existing atomic review command without copying an older function
-- body. Fail closed when its expected validation contract has changed.
do $$
declare
  function_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.review_transfer_slip_details(uuid,text,text,text,text,text,text,text,text,numeric,timestamp with time zone,text,text)'::regprocedure
  ) into function_definition;
  patched_definition := replace(function_definition, '''^[0-9]{4}$''', '''^[0-9]{3,4}$''');
  if patched_definition = function_definition then
    raise exception 'review_transfer_slip_details_mask_validation_contract_changed';
  end if;
  execute patched_definition;

  select pg_get_functiondef('public.sync_transfer_slip_account_pair()'::regprocedure)
  into function_definition;
  patched_definition := replace(function_definition, '''^[0-9]{4}$''', '''^[0-9]{3,4}$''');
  if patched_definition = function_definition then
    raise exception 'sync_transfer_slip_account_pair_mask_validation_contract_changed';
  end if;
  execute patched_definition;
end;
$$;

-- Draft classification command used before party linking. It only accepts an
-- existing advance allocation in the governed lineage and records an
-- append-only audit event. Repeating the same event key is idempotent.
create or replace function public.classify_transfer_slip_advance_draft_v1(
  target_item_id uuid,
  target_event_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.document_flow_items;
  transaction_row public.financial_transactions;
  lineage_row public.transfer_slip_money_lineages;
  existing_payload jsonb;
begin
  if auth.uid() is null then raise exception 'workflow_authentication_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'workflow_event_key_required'; end if;

  select payload into existing_payload
  from public.document_flow_events where event_key=target_event_key limit 1;
  if existing_payload is not null then return existing_payload; end if;

  select * into item_row from public.document_flow_items where id=target_item_id for update;
  if item_row.id is null or item_row.document_type<>'transfer_slip' then raise exception 'transfer_slip_item_not_found'; end if;
  if not public.is_platform_admin() and not public.is_company_manager(item_row.company_id)
    and not public.is_document_flow_department_member(item_row.company_id,'accounting')
  then raise exception 'workflow_permission_denied'; end if;

  select * into transaction_row from public.financial_transactions
  where source_message_id=item_row.source_message_id and review_status not in ('duplicate','dismissed')
  order by created_at desc limit 1 for update;
  if transaction_row.id is null then raise exception 'financial_transaction_not_found'; end if;

  select * into lineage_row from public.transfer_slip_money_lineages
  where item_id=item_row.id for update;
  if lineage_row.id is null or not exists (
    select 1 from public.transfer_slip_money_allocations allocation
    where allocation.lineage_id=lineage_row.id
      and allocation.status<>'superseded'
      and allocation.purpose_type='advance_transfer'
  ) then raise exception 'advance_allocation_draft_required'; end if;

  update public.financial_transactions
  set expense_type='advance',updated_at=now()
  where id=transaction_row.id and expense_type is distinct from 'advance';

  insert into public.document_flow_events(
    item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,
    from_room,to_room,note,payload,actor_id
  ) values (
    item_row.id,item_row.company_id,target_event_key,'transfer_slip_advance_draft_classified',
    item_row.current_flow,item_row.current_flow,item_row.state,item_row.state,
    item_row.current_room,item_row.current_room,
    'ยืนยันประเภทตั้งต้น/เติมกองเงินก่อนเชื่อมผู้ถือเงิน โดยยังไม่ปิดงาน',
    jsonb_build_object('item_id',item_row.id,'transaction_id',transaction_row.id,'lineage_id',lineage_row.id,'expense_type','advance','purpose_type','advance_transfer'),
    auth.uid()
  ) returning payload into existing_payload;
  return existing_payload;
end;
$$;

revoke all on function public.classify_transfer_slip_advance_draft_v1(uuid,text) from public,anon;
grant execute on function public.classify_transfer_slip_advance_draft_v1(uuid,text) to authenticated;

-- Re-evaluate existing eligible three-digit pairs without touching raw evidence.
update public.financial_transactions
set payment_party_confidence=payment_party_confidence
where sender_account_last4 ~ '^[0-9]{3}$'
   or recipient_account_last4 ~ '^[0-9]{3}$';

notify pgrst,'reload schema';

-- Rollback: restore 4-digit checks only after first reconciling any 3-digit
-- evidence rows. Drop classify_transfer_slip_advance_draft_v1 and redeploy the
-- previous Edge Function. Preserve all source facts and document_flow_events.
