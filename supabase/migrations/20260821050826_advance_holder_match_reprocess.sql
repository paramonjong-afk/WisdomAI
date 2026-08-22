-- A holder registration is also a correction to the matching rules. Recheck
-- existing source slips through the same idempotent central function.
create or replace function public.reprocess_advance_holder_matches(target_company_id uuid)
returns void
language plpgsql security definer set search_path=public as $$
declare source_id uuid;
begin
  for source_id in
    select source_message_id
    from public.financial_transactions
    where company_id=target_company_id and source_message_id is not null
  loop
    perform public.auto_create_safe_employee_advance_from_transfer(source_id);
  end loop;
end;
$$;

create or replace function public.reprocess_advance_holder_from_holder_trigger()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform public.reprocess_advance_holder_matches(new.company_id);
  return new;
end;
$$;

create or replace function public.reprocess_advance_holder_from_alias_trigger()
returns trigger
language plpgsql security definer set search_path=public as $$
declare target_company_id uuid;
begin
  select company_id into target_company_id from public.employee_advance_holders where id=new.holder_id;
  if target_company_id is not null then perform public.reprocess_advance_holder_matches(target_company_id); end if;
  return new;
end;
$$;

drop trigger if exists reprocess_advance_holder_matches_from_holder on public.employee_advance_holders;
create trigger reprocess_advance_holder_matches_from_holder
after insert or update of display_name,destination_bank_name,destination_account_last4,is_active
on public.employee_advance_holders
for each row execute function public.reprocess_advance_holder_from_holder_trigger();

drop trigger if exists reprocess_advance_holder_matches_from_alias on public.employee_advance_holder_aliases;
create trigger reprocess_advance_holder_matches_from_alias
after insert or update of alias_name
on public.employee_advance_holder_aliases
for each row execute function public.reprocess_advance_holder_from_alias_trigger();

revoke all on function public.reprocess_advance_holder_matches(uuid),
  public.reprocess_advance_holder_from_holder_trigger(),
  public.reprocess_advance_holder_from_alias_trigger()
from public,anon,authenticated;
notify pgrst,'reload schema';
