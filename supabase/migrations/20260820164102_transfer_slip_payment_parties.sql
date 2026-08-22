-- Transfer-slip parties are stored separately from the LINE sender. Account numbers
-- are intentionally retained only as masked last-four digits for matching/rules.
alter table public.financial_transactions
  add column if not exists sender_name text,
  add column if not exists sender_bank_name text,
  add column if not exists sender_account_last4 text,
  add column if not exists recipient_bank_name text,
  add column if not exists recipient_account_last4 text,
  add column if not exists payment_party_confidence numeric(4,3);

alter table public.financial_transactions
  drop constraint if exists financial_transactions_sender_account_last4_check,
  drop constraint if exists financial_transactions_recipient_account_last4_check,
  drop constraint if exists financial_transactions_payment_party_confidence_check;

alter table public.financial_transactions
  add constraint financial_transactions_sender_account_last4_check
    check (sender_account_last4 is null or sender_account_last4 ~ '^[0-9]{4}$'),
  add constraint financial_transactions_recipient_account_last4_check
    check (recipient_account_last4 is null or recipient_account_last4 ~ '^[0-9]{4}$'),
  add constraint financial_transactions_payment_party_confidence_check
    check (payment_party_confidence is null or payment_party_confidence between 0 and 1);

comment on column public.financial_transactions.sender_name is 'Name visibly shown as transfer sender; never inferred from the LINE uploader.';
comment on column public.financial_transactions.sender_bank_name is 'Transfer source bank read from the slip.';
comment on column public.financial_transactions.sender_account_last4 is 'Last 4 digits only; full source account is not stored in the workflow registry.';
comment on column public.financial_transactions.recipient_bank_name is 'Transfer destination bank read from the slip.';
comment on column public.financial_transactions.recipient_account_last4 is 'Last 4 digits only; full destination account is not stored in the workflow registry.';
comment on column public.financial_transactions.payment_party_confidence is 'AI confidence for the payment-party fields only.';
