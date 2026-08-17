-- Group consecutive LINE accounting images into one reviewable multi-page set.
create table if not exists public.accounting_document_sets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  line_group_id text,
  line_user_id text,
  first_received_at timestamptz not null,
  last_received_at timestamptz not null,
  page_count integer not null default 1 check (page_count > 0),
  status text not null default 'collecting' check (status in ('collecting','needs_review','merged','confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounting_documents
  add column if not exists document_set_id uuid references public.accounting_document_sets(id) on delete set null,
  add column if not exists page_number integer;

create table if not exists public.accounting_document_attachments (
  document_id uuid not null references public.accounting_documents(id) on delete cascade,
  message_id uuid not null references public.line_messages(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  created_at timestamptz not null default now(),
  primary key (document_id, message_id)
);

create index if not exists accounting_document_sets_lookup_idx
  on public.accounting_document_sets(company_id,line_group_id,line_user_id,last_received_at desc);
create index if not exists accounting_documents_set_idx on public.accounting_documents(document_set_id);

alter table public.accounting_document_sets enable row level security;
alter table public.accounting_document_attachments enable row level security;

drop policy if exists "Company members read accounting document sets" on public.accounting_document_sets;
create policy "Company members read accounting document sets" on public.accounting_document_sets
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "Managers manage accounting document sets" on public.accounting_document_sets;
create policy "Managers manage accounting document sets" on public.accounting_document_sets
  for all to authenticated using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

drop policy if exists "Company members read accounting document attachments" on public.accounting_document_attachments;
create policy "Company members read accounting document attachments" on public.accounting_document_attachments
  for select to authenticated using (exists (
    select 1 from public.accounting_documents d where d.id=document_id and public.is_company_member(d.company_id)
  ));
drop policy if exists "Managers manage accounting document attachments" on public.accounting_document_attachments;
create policy "Managers manage accounting document attachments" on public.accounting_document_attachments
  for all to authenticated using (exists (
    select 1 from public.accounting_documents d where d.id=document_id and public.is_company_manager(d.company_id)
  )) with check (exists (
    select 1 from public.accounting_documents d where d.id=document_id and public.is_company_manager(d.company_id)
  ));

create or replace function public.assign_accounting_document_set(
  p_company_id uuid,
  p_message_id uuid,
  p_window_seconds integer default 180
) returns table(set_id uuid,page_number integer)
language plpgsql security definer set search_path=public as $$
declare
  v_message public.line_messages;
  v_set public.accounting_document_sets;
  v_page integer;
begin
  select * into v_message from public.line_messages where id=p_message_id and company_id=p_company_id;
  if not found then raise exception 'line_message_not_found'; end if;

  select * into v_set from public.accounting_document_sets s
  where s.company_id=p_company_id
    and s.line_group_id is not distinct from v_message.line_group_id
    and s.line_user_id is not distinct from v_message.line_user_id
    and s.status in ('collecting','needs_review')
    and s.last_received_at >= v_message.occurred_at - make_interval(secs=>greatest(30,p_window_seconds))
    and s.last_received_at <= v_message.occurred_at + interval '10 seconds'
  order by s.last_received_at desc limit 1 for update;

  if found then
    v_page:=v_set.page_count+1;
    update public.accounting_document_sets set
      last_received_at=greatest(last_received_at,v_message.occurred_at),page_count=v_page,
      status='needs_review',updated_at=now()
    where id=v_set.id;
  else
    insert into public.accounting_document_sets(company_id,line_group_id,line_user_id,first_received_at,last_received_at)
    values(p_company_id,v_message.line_group_id,v_message.line_user_id,v_message.occurred_at,v_message.occurred_at)
    returning * into v_set;
    v_page:=1;
  end if;
  return query select v_set.id,v_page;
end $$;

create or replace function public.merge_accounting_document_set(p_primary_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_primary public.accounting_documents;
  v_other record;
  v_page integer:=0;
  v_count integer:=0;
begin
  select * into v_primary from public.accounting_documents where id=p_primary_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if not public.is_company_manager(v_primary.company_id) then raise exception 'permission_denied'; end if;
  if v_primary.document_set_id is null then raise exception 'document_has_no_set'; end if;
  if v_primary.status not in ('pending','needs_correction') then raise exception 'primary_document_is_locked'; end if;

  for v_other in
    select d.* from public.accounting_documents d
    where d.document_set_id=v_primary.document_set_id and d.status in ('pending','needs_correction','duplicate')
    order by d.page_number nulls last,d.created_at,d.id
  loop
    v_page:=v_page+1;
    insert into public.accounting_document_attachments(document_id,message_id,page_number)
    values(v_primary.id,v_other.source_message_id,v_page)
    on conflict(document_id,message_id) do update set page_number=excluded.page_number;
    if v_other.id<>v_primary.id then
      update public.accounting_documents set status='dismissed',duplicate_of=v_primary.id,
        notes=concat_ws(' | ',notes,'รวมเป็นหน้าเอกสารของ '||v_primary.id::text),updated_at=now()
      where id=v_other.id;
    end if;
    v_count:=v_count+1;
  end loop;

  update public.accounting_documents set status='needs_correction',page_number=1,
    risk_flags=array(select distinct x from unnest(coalesce(risk_flags,'{}'::text[])||array['multi_page_review_required']) x),
    notes=concat_ws(' | ',notes,'รวมชุดเอกสาร '||v_count||' หน้าแล้ว กรุณาตรวจประเภท ผู้ขาย รายการ และยอดรวม'),updated_at=now()
  where id=v_primary.id;
  update public.accounting_document_sets set status='merged',page_count=v_count,updated_at=now()
  where id=v_primary.document_set_id;
  return jsonb_build_object('document_id',v_primary.id,'page_count',v_count,'status','needs_correction');
end $$;

grant execute on function public.assign_accounting_document_set(uuid,uuid,integer) to service_role;
grant execute on function public.merge_accounting_document_set(uuid) to authenticated;

-- Existing one-page documents remain valid attachments. Consecutive unreviewed LINE
-- images are backfilled into sets using a three-minute gap rule.
with ordered as (
  select d.id,d.company_id,d.source_message_id,m.line_group_id,m.line_user_id,m.occurred_at,
    lag(m.occurred_at) over(partition by d.company_id,m.line_group_id,m.line_user_id order by m.occurred_at,d.id) prev_at
  from public.accounting_documents d join public.line_messages m on m.id=d.source_message_id
  where d.document_set_id is null and d.status in ('pending','needs_correction')
), grouped as (
  select *,sum(case when prev_at is null or occurred_at-prev_at>interval '3 minutes' then 1 else 0 end)
    over(partition by company_id,line_group_id,line_user_id order by occurred_at,id) grp
  from ordered
), created as (
  insert into public.accounting_document_sets(company_id,line_group_id,line_user_id,first_received_at,last_received_at,page_count,status)
  select company_id,line_group_id,line_user_id,min(occurred_at),max(occurred_at),count(*),
    case when count(*)>1 then 'needs_review' else 'collecting' end
  from grouped group by company_id,line_group_id,line_user_id,grp
  returning id,company_id,line_group_id,line_user_id,first_received_at,last_received_at
)
update public.accounting_documents d set document_set_id=c.id
from created c,public.line_messages m
where m.id=d.source_message_id and d.document_set_id is null and d.status in ('pending','needs_correction')
  and d.company_id=c.company_id and m.line_group_id is not distinct from c.line_group_id
  and m.line_user_id is not distinct from c.line_user_id and m.occurred_at between c.first_received_at and c.last_received_at;

with numbered as (
  select d.id,row_number() over(partition by d.document_set_id order by m.occurred_at,d.id)::integer page
  from public.accounting_documents d join public.line_messages m on m.id=d.source_message_id
  where d.document_set_id is not null
)
update public.accounting_documents d set page_number=n.page from numbered n where n.id=d.id;

insert into public.accounting_document_attachments(document_id,message_id,page_number)
select id,source_message_id,coalesce(page_number,1) from public.accounting_documents
on conflict do nothing;
