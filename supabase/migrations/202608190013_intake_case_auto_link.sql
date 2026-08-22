create or replace function public.document_flow_item_intake_case_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.intake_case_id is null and new.source_message_id is not null then
    perform public.link_document_flow_item_to_intake_case(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists document_flow_item_intake_case_link on public.document_flow_items;
create trigger document_flow_item_intake_case_link
after insert on public.document_flow_items for each row execute function public.document_flow_item_intake_case_trigger();
