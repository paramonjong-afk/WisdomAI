-- DOC-INGEST-006 completion contract. Deployment remains a separate reviewed action.
alter table public.accounting_document_sets
  add column if not exists expected_page_count integer check (expected_page_count is null or expected_page_count > 0),
  add column if not exists collection_closed_at timestamptz,
  add column if not exists incomplete_notified_at timestamptz;

alter table public.accounting_document_sets drop constraint if exists accounting_document_sets_status_check;
alter table public.accounting_document_sets add constraint accounting_document_sets_status_check
  check (status in ('collecting','needs_review','incomplete','merged','confirmed'));

create or replace function public.refresh_accounting_document_set(p_set_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_count integer; v_expected integer; v_closed timestamptz; v_status text;
begin
  with numbered as (
    select d.id,row_number() over(order by m.occurred_at,m.id,d.id)::integer page
    from public.accounting_documents d join public.line_messages m on m.id=d.source_message_id
    where d.document_set_id=p_set_id and d.status not in ('dismissed','duplicate')
  ) update public.accounting_documents d set page_number=n.page,updated_at=now()
    from numbered n where d.id=n.id and d.page_number is distinct from n.page;
  select count(*) into v_count from public.accounting_documents where document_set_id=p_set_id and status not in ('dismissed','duplicate');
  select expected_page_count,collection_closed_at into v_expected,v_closed from public.accounting_document_sets where id=p_set_id for update;
  if not found then raise exception 'document_set_not_found'; end if;
  v_status:=case when v_closed is not null and v_expected is not null and v_count<>v_expected then 'incomplete'
    when v_count>1 then 'needs_review' else 'collecting' end;
  update public.accounting_document_sets set page_count=greatest(v_count,1),status=v_status,updated_at=now() where id=p_set_id;
  return jsonb_build_object('set_id',p_set_id,'page_count',v_count,'expected_page_count',v_expected,
    'complete',v_expected is null or v_count=v_expected,'status',v_status);
end $$;

create or replace function public.close_accounting_document_set(p_company_id uuid,p_line_group_id text,p_line_user_id text,p_expected_page_count integer default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_set_id uuid;
begin
  if p_expected_page_count is not null and p_expected_page_count<1 then raise exception 'expected_page_count_must_be_positive'; end if;
  select id into v_set_id from public.accounting_document_sets where company_id=p_company_id
    and line_group_id is not distinct from p_line_group_id and line_user_id is not distinct from p_line_user_id
    and status in ('collecting','needs_review','incomplete') order by last_received_at desc limit 1 for update;
  if v_set_id is null then raise exception 'open_document_set_not_found'; end if;
  update public.accounting_document_sets set expected_page_count=coalesce(p_expected_page_count,expected_page_count),
    collection_closed_at=now(),updated_at=now() where id=v_set_id;
  return public.refresh_accounting_document_set(v_set_id);
end $$;

create or replace function public.claim_incomplete_accounting_document_sets(p_older_than_seconds integer default 180,p_limit integer default 50)
returns table(set_id uuid,company_id uuid,line_group_id text,line_user_id text,page_count integer,expected_page_count integer)
language plpgsql security definer set search_path=public as $$
begin
  return query with claimed as (
    select s.id from public.accounting_document_sets s where s.status in ('collecting','needs_review','incomplete')
      and s.incomplete_notified_at is null and s.last_received_at<now()-make_interval(secs=>greatest(30,p_older_than_seconds))
      and (s.expected_page_count is null or s.page_count<>s.expected_page_count)
    order by s.last_received_at for update skip locked limit greatest(1,least(p_limit,200))
  ), updated as (
    update public.accounting_document_sets s set status='incomplete',incomplete_notified_at=now(),updated_at=now()
    from claimed c where s.id=c.id returning s.id,s.company_id,s.line_group_id,s.line_user_id,s.page_count,s.expected_page_count
  ) select * from updated;
end $$;

create or replace function public.assert_accounting_document_set_complete(p_set_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_set public.accounting_document_sets;
begin
  select * into v_set from public.accounting_document_sets where id=p_set_id;
  if not found then raise exception 'document_set_not_found'; end if;
  if v_set.expected_page_count is not null and v_set.page_count<>v_set.expected_page_count then
    raise exception 'document_set_incomplete_expected_%_actual_%',v_set.expected_page_count,v_set.page_count;
  end if;
end $$;

grant execute on function public.refresh_accounting_document_set(uuid) to service_role;
grant execute on function public.close_accounting_document_set(uuid,text,text,integer) to service_role;
grant execute on function public.claim_incomplete_accounting_document_sets(integer,integer) to service_role;
grant execute on function public.assert_accounting_document_set_complete(uuid) to authenticated;

update public.system_work_items set status='review',progress=90,production_status='source_ready_not_deployed',
  evidence=left(concat_ws(E'\n',evidence,'Source 202608160020 adds event-time page ordering, redelivery idempotency, expected count, explicit close-set, incomplete notification claim, and completeness guard. Contract: scripts/line-accounting-document-sets.test.ts.'),4000),
  current_step='Review/deploy in an approved release, integrate LINE close-set/notification worker, then run reordered, duplicate, missing, timeout, merge, detach and confirmation UAT.',
  error_fingerprint='doc-ingest-006:deployment-line-integration-uat-required',updated_at=now()
where work_key='DOC-INGEST-006';
