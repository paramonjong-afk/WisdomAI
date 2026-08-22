-- A case is the conversational envelope.  It keeps original messages and
-- attachments separate from the documents subsequently created from them.
create table if not exists public.intake_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_channel text not null default 'unknown',
  source_room_id text,
  source_room_name text,
  source_sender_id text,
  source_sender_name text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  match_status text not null default 'automatic' check(match_status in ('automatic','needs_review','manual_confirmed','locked')),
  match_confidence numeric(5,4) not null default 1 check(match_confidence between 0 and 1),
  match_method text not null default 'direct_attachment',
  match_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists intake_cases_company_source_idx on public.intake_cases(company_id,source_channel,source_room_id,opened_at desc);

create table if not exists public.intake_case_messages (
  case_id uuid not null references public.intake_cases(id) on delete cascade,
  line_message_id uuid references public.line_messages(id) on delete cascade,
  relation_role text not null default 'primary' check(relation_role in ('primary','context_before','context_after','manual_context')),
  sequence_no integer not null default 0,
  match_confidence numeric(5,4) not null default 1 check(match_confidence between 0 and 1),
  match_method text not null default 'direct_attachment',
  match_reason text,
  created_at timestamptz not null default now(),
  primary key(case_id,line_message_id)
);
create table if not exists public.intake_case_attachments (
  case_id uuid not null references public.intake_cases(id) on delete cascade,
  line_attachment_id uuid references public.line_attachments(id) on delete cascade,
  relation_role text not null default 'primary' check(relation_role in ('primary','supporting','duplicate','manual_added')),
  match_confidence numeric(5,4) not null default 1 check(match_confidence between 0 and 1),
  match_method text not null default 'direct_attachment',
  match_reason text,
  created_at timestamptz not null default now(),
  primary key(case_id,line_attachment_id)
);
alter table public.document_flow_items add column if not exists intake_case_id uuid references public.intake_cases(id) on delete set null;
create index if not exists document_flow_items_intake_case_idx on public.document_flow_items(intake_case_id);

alter table public.intake_cases enable row level security;
alter table public.intake_case_messages enable row level security;
alter table public.intake_case_attachments enable row level security;
create policy "Authorized users read intake cases" on public.intake_cases for select to authenticated using(company_id=public.current_company_id() and (public.is_platform_admin() or public.is_company_manager(company_id)));
create policy "Authorized users read intake case messages" on public.intake_case_messages for select to authenticated using(exists(select 1 from public.intake_cases c where c.id=case_id and c.company_id=public.current_company_id() and (public.is_platform_admin() or public.is_company_manager(c.company_id))));
create policy "Authorized users read intake case attachments" on public.intake_case_attachments for select to authenticated using(exists(select 1 from public.intake_cases c where c.id=case_id and c.company_id=public.current_company_id() and (public.is_platform_admin() or public.is_company_manager(c.company_id))));

create or replace function public.link_document_flow_item_to_intake_case(target_item_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare item public.document_flow_items; case_id uuid;
begin
  select * into item from public.document_flow_items where id=target_item_id;
  if item.id is null or item.source_message_id is null then return null; end if;
  select c.id into case_id from public.intake_cases c join public.intake_case_messages m on m.case_id=c.id where c.company_id=item.company_id and m.line_message_id=item.source_message_id limit 1;
  if case_id is null then
    insert into public.intake_cases(company_id,source_channel,source_room_id,source_room_name,source_sender_id,source_sender_name,opened_at,match_status,match_confidence,match_method,match_reason)
    values(item.company_id,item.source_channel,item.source_room_id,item.source_room_name,item.source_sender_id,item.source_sender_name,coalesce(item.source_received_at,item.created_at),'automatic',1,'direct_attachment','ข้อความและไฟล์แนบต้นทางเดียวกัน') returning id into case_id;
    insert into public.intake_case_messages(case_id,line_message_id,relation_role,sequence_no,match_confidence,match_method) values(case_id,item.source_message_id,'primary',0,1,'direct_attachment');
    insert into public.intake_case_attachments(case_id,line_attachment_id,relation_role,match_confidence,match_method)
      select case_id,id,'primary',1,'direct_attachment' from public.line_attachments where message_id=item.source_message_id on conflict do nothing;
  end if;
  update public.document_flow_items set intake_case_id=case_id where id=item.id;
  return case_id;
end;
$$;

do $$ declare row record; begin
  for row in select id from public.document_flow_items where intake_case_id is null and source_message_id is not null loop
    perform public.link_document_flow_item_to_intake_case(row.id);
  end loop;
end $$;
revoke all on function public.link_document_flow_item_to_intake_case(uuid) from public,anon;
grant execute on function public.link_document_flow_item_to_intake_case(uuid) to authenticated;
