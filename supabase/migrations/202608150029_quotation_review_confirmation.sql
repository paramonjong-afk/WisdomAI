-- A quotation decision completes document review but never creates an accounting posting.
create or replace function public.confirm_quotation_review_after_decision()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status<>'pending' and old.status is distinct from new.status then
    update public.accounting_documents set
      status='confirmed',posting_status='not_posted',reviewed_by=coalesce(new.decided_by,auth.uid()),
      reviewed_at=coalesce(new.decided_at,now()),updated_at=now()
    where id=new.document_id and document_type='quotation';
  end if;
  return new;
end;
$$;
drop trigger if exists confirm_quotation_review_after_decision_trigger on public.quotation_decisions;
create trigger confirm_quotation_review_after_decision_trigger
after update of status on public.quotation_decisions
for each row execute function public.confirm_quotation_review_after_decision();

update public.accounting_documents document set
  status='confirmed',posting_status='not_posted',reviewed_by=decision.decided_by,
  reviewed_at=decision.decided_at,updated_at=now()
from public.quotation_decisions decision
where decision.document_id=document.id and decision.status<>'pending'
  and document.document_type='quotation' and document.status in ('pending','needs_correction');

comment on function public.confirm_quotation_review_after_decision() is
  'Marks quotation review complete while forcing posting_status=not_posted; purchase/expense accounting occurs from later receiving or invoice documents.';
notify pgrst,'reload schema';
