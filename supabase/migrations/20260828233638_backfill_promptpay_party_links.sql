-- Link legacy PromptPay evidence to the correct transaction side. These rows
-- remain evidence_only until an authorised reviewer confirms the owner.

with source_rows as (
  select
    alias.id alias_id,
    alias.company_id,
    transaction.id transaction_id,
    case
      when coalesce(transaction.sender_bank_name,'') ~* '(prompt[[:space:]_-]*pay|พร้อม[[:space:]]*เพย์)'
        and public.normalize_master_data_name(transaction.sender_name)=alias.normalized_owner_name then 'sender'
      else 'recipient'
    end party_role,
    transaction.sender_name,transaction.sender_bank_name,transaction.sender_account_last4,
    transaction.recipient_name,transaction.recipient_bank_name,transaction.recipient_account_last4
  from public.master_payment_aliases alias
  join public.financial_transactions transaction on transaction.id=alias.evidence_source_id
  where alias.evidence_source_table='financial_transactions'
    and alias.alias_type='unknown_masked'
    and alias.verification_status='unverified'
    and (
      coalesce(transaction.sender_bank_name,'') ~* '(prompt[[:space:]_-]*pay|พร้อม[[:space:]]*เพย์)'
      or coalesce(transaction.recipient_bank_name,'') ~* '(prompt[[:space:]_-]*pay|พร้อม[[:space:]]*เพย์)'
    )
)
insert into public.financial_transaction_party_links(
  company_id,financial_transaction_id,party_role,payment_method,evidence_name,evidence_bank_name,evidence_account_last4,
  canonical_party_name,payment_alias_id,match_status,match_reason,source_snapshot,event_key
)
select company_id,transaction_id,party_role,'promptpay',
  case when party_role='sender' then sender_name else recipient_name end,
  case when party_role='sender' then sender_bank_name else recipient_bank_name end,
  case when party_role='sender' then sender_account_last4 else recipient_account_last4 end,
  case when party_role='sender' then sender_name else recipient_name end,
  alias_id,'evidence_only','Backfill จากสลิปเดิมที่ระบุ PromptPay; ยังไม่ยืนยันเจ้าของ',
  jsonb_build_object('source','financial_transactions','transaction_id',transaction_id,'backfill',true),
  'promptpay-backfill:'||transaction_id::text||':'||party_role
from source_rows
on conflict(company_id,financial_transaction_id,party_role) do nothing;

insert into public.payment_alias_audit(company_id,payment_alias_id,party_link_id,financial_transaction_id,event_key,action,after_data,reason)
select link.company_id,link.payment_alias_id,link.id,link.financial_transaction_id,
  link.event_key,'promptpay_evidence_backfilled',to_jsonb(link),'เชื่อมหลักฐานเดิมเท่านั้น ยังไม่ยืนยันเจ้าของ PromptPay'
from public.financial_transaction_party_links link
where link.event_key like 'promptpay-backfill:%'
on conflict(company_id,event_key) do nothing;

notify pgrst,'reload schema';
