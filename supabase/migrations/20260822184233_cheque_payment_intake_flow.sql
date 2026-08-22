-- Cheques reuse the central financial-evidence record. Chat uploader identity
-- is never used as the cheque drawer or payee.
alter table public.financial_transactions
  add column if not exists payment_evidence_type text not null default 'transfer_slip',
  add column if not exists cheque_number text,
  add column if not exists cheque_issued_on date,
  add column if not exists cheque_drawer_name text,
  add column if not exists cheque_payee_name text,
  add column if not exists cheque_bank_name text,
  add column if not exists cheque_account_last4 text,
  add column if not exists cheque_extraction_confidence numeric(4,3),
  add column if not exists cheque_match_status text not null default 'unmatched',
  add column if not exists cheque_matched_entity_type text,
  add column if not exists cheque_matched_entity_id uuid;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_payment_evidence_type_check,
  drop constraint if exists financial_transactions_cheque_account_last4_check,
  drop constraint if exists financial_transactions_cheque_extraction_confidence_check,
  drop constraint if exists financial_transactions_cheque_match_status_check;

alter table public.financial_transactions
  add constraint financial_transactions_payment_evidence_type_check check (payment_evidence_type in ('transfer_slip','cheque_payment')),
  add constraint financial_transactions_cheque_account_last4_check check (cheque_account_last4 is null or cheque_account_last4 ~ '^[0-9]{4}$'),
  add constraint financial_transactions_cheque_extraction_confidence_check check (cheque_extraction_confidence is null or cheque_extraction_confidence between 0 and 1),
  add constraint financial_transactions_cheque_match_status_check check (cheque_match_status in ('unmatched','matched','needs_review','duplicate'));

create index if not exists financial_transactions_cheque_lookup_idx
  on public.financial_transactions (cheque_bank_name, cheque_number, cheque_issued_on, amount_total)
  where payment_evidence_type = 'cheque_payment';

create or replace function public.apply_cheque_payment_dedupe()
returns trigger language plpgsql set search_path = public as $$
declare primary_id uuid;
begin
  if new.payment_evidence_type <> 'cheque_payment' or nullif(btrim(coalesce(new.cheque_number,'')),'') is null
    or nullif(btrim(coalesce(new.cheque_bank_name,'')),'') is null or new.cheque_issued_on is null or new.amount_total is null then
    return new;
  end if;
  select id into primary_id from public.financial_transactions
  where id <> coalesce(new.id, gen_random_uuid()) and payment_evidence_type = 'cheque_payment' and review_status <> 'duplicate'
    and lower(btrim(cheque_number)) = lower(btrim(new.cheque_number))
    and lower(btrim(cheque_bank_name)) = lower(btrim(new.cheque_bank_name))
    and cheque_issued_on = new.cheque_issued_on and amount_total = new.amount_total
  order by created_at asc limit 1;
  if primary_id is not null then
    new.duplicate_of := primary_id; new.review_status := 'duplicate'; new.cheque_match_status := 'duplicate';
    new.notes := concat_ws(E'\n', nullif(new.notes,''), 'ระบบประทับรายการซ้ำของเช็ค อ้างอิงธุรกรรม ' || primary_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists apply_cheque_payment_dedupe_on_financial_transaction on public.financial_transactions;
create trigger apply_cheque_payment_dedupe_on_financial_transaction
before insert or update of payment_evidence_type, cheque_number, cheque_bank_name, cheque_issued_on, amount_total
on public.financial_transactions for each row execute function public.apply_cheque_payment_dedupe();

create or replace function public.auto_route_cheque_payment_flow(target_source_message_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare evidence public.financial_transactions; item public.document_flow_items; next_state text; next_room text; next_issues text[];
begin
  select * into evidence from public.financial_transactions where source_message_id = target_source_message_id and payment_evidence_type = 'cheque_payment' limit 1;
  if evidence.id is null then return; end if;
  select * into item from public.document_flow_items where source_message_id = target_source_message_id for update;
  if item.id is null then return; end if;
  if evidence.review_status = 'duplicate' then
    next_state := 'duplicate_hold'; next_room := 'intake_duplicate_hold'; next_issues := array['possible_duplicate'];
  elsif evidence.cheque_number is null or evidence.cheque_drawer_name is null or evidence.cheque_payee_name is null
    or evidence.cheque_bank_name is null or evidence.cheque_issued_on is null or evidence.amount_total is null
    or coalesce(evidence.cheque_extraction_confidence,0) < .90 then
    next_state := 'needs_correction'; next_room := 'intake_cheque_review'; next_issues := array['cheque_data_incomplete'];
  elsif item.current_flow = 'filter' and item.state = 'validating' then
    update public.document_flow_items set document_type='cheque_payment', route_target='cheque_payment_verification',
      current_room='filter_cheque_verification', target_department='accounting', candidate_departments=array['accounting']::text[],
      sensitivity='financial', classification_note='ตรวจพบเช็คสั่งจ่าย: รอตรวจบัญชีและผู้รับเงิน', version=version+1, updated_at=now() where id=item.id;
    insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload)
    values(item.id,item.company_id,'cheque-payment-filter:'||item.id::text||':'||(item.version+1)::text,'cheque_payment_routed_to_filter',item.current_flow,item.current_flow,item.state,item.state,item.current_room,'filter_cheque_verification','เช็คผ่าน Intake แล้ว ส่งเข้าคิว Filter ของบัญชี',jsonb_build_object('cheque_number',evidence.cheque_number,'payee',evidence.cheque_payee_name)) on conflict(event_key) do nothing;
    return;
  else return;
  end if;
  update public.document_flow_items set document_type='cheque_payment', current_flow='intake', state=next_state, current_room=next_room,
    route_target='cheque_payment_verification', target_department='admin', candidate_departments=array['admin']::text[], issue_codes=next_issues,
    sensitivity='financial', auto_routed=false, classification_note=case when next_state='duplicate_hold' then 'ระบบประทับเช็คซ้ำ รออ้างอิงไฟล์หลัก' else 'ข้อมูลเช็คไม่ครบหรือ AI ยังไม่มั่นใจ รอ Admin ตรวจ' end,
    version=version+1, updated_at=now() where id=item.id;
end;
$$;

create or replace function public.auto_route_cheque_payment_from_financial_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.auto_route_cheque_payment_flow(new.source_message_id); return new; end; $$;
create or replace function public.auto_route_cheque_payment_from_flow_trigger()
returns trigger language plpgsql security definer set search_path = public as $$ begin perform public.auto_route_cheque_payment_flow(new.source_message_id); return new; end; $$;

drop trigger if exists auto_route_cheque_payment_from_financial on public.financial_transactions;
create trigger auto_route_cheque_payment_from_financial after insert or update of payment_evidence_type, cheque_number, cheque_issued_on, cheque_drawer_name, cheque_payee_name, cheque_bank_name, amount_total, cheque_extraction_confidence, review_status on public.financial_transactions for each row execute function public.auto_route_cheque_payment_from_financial_trigger();
drop trigger if exists auto_route_cheque_payment_from_flow on public.document_flow_items;
create trigger auto_route_cheque_payment_from_flow after insert or update of source_message_id, current_flow, state on public.document_flow_items for each row execute function public.auto_route_cheque_payment_from_flow_trigger();

revoke all on function public.auto_route_cheque_payment_flow(uuid), public.auto_route_cheque_payment_from_financial_trigger(), public.auto_route_cheque_payment_from_flow_trigger() from public, anon, authenticated;
comment on column public.financial_transactions.cheque_payee_name is 'Payee on the cheque, never inferred from the chat uploader.';
comment on column public.financial_transactions.cheque_account_last4 is 'Only final four digits may be retained.';
notify pgrst, 'reload schema';
