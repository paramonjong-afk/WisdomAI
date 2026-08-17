update public.line_attachments
set duplicate_of = null
where duplicate_of = id;

update public.financial_transactions
set
  duplicate_of = null,
  review_status = 'pending',
  updated_at = now()
where duplicate_of = id;

update public.accounting_documents
set
  duplicate_of = null,
  status = case
    when status = 'duplicate' then 'pending'
    else status
  end,
  updated_at = now()
where duplicate_of = id;

alter table public.line_attachments
  drop constraint if exists line_attachments_duplicate_not_self;
alter table public.line_attachments
  add constraint line_attachments_duplicate_not_self
  check (duplicate_of is null or duplicate_of <> id);

alter table public.financial_transactions
  drop constraint if exists financial_transactions_duplicate_not_self;
alter table public.financial_transactions
  add constraint financial_transactions_duplicate_not_self
  check (duplicate_of is null or duplicate_of <> id);

alter table public.accounting_documents
  drop constraint if exists accounting_documents_duplicate_not_self;
alter table public.accounting_documents
  add constraint accounting_documents_duplicate_not_self
  check (duplicate_of is null or duplicate_of <> id);
