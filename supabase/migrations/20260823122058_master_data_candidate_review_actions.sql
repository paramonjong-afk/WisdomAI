-- Local-first source contract for explicit Candidate review decisions.
-- This migration is prepared only; it must not be applied to Production here.
alter table public.master_data_candidates
  drop constraint if exists master_data_candidates_status_check;

alter table public.master_data_candidates
  add constraint master_data_candidates_status_check
  check (status in ('provisional','needs_review','confirmed','locked','pending_review','approved','rejected','archived','needs_more_info'));

create table if not exists public.master_data_candidate_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  candidate_id uuid not null references public.master_data_candidates(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null,
  data jsonb not null default '{}'::jsonb,
  source_table text,
  source_id uuid,
  audit_event_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(candidate_id,version_no)
);
alter table public.master_data_candidate_versions enable row level security;
drop policy if exists "Company managers read candidate versions" on public.master_data_candidate_versions;
create policy "Company managers read candidate versions" on public.master_data_candidate_versions for select to authenticated using (public.is_company_manager(company_id));
revoke insert,update,delete on public.master_data_candidate_versions from anon,authenticated;
grant select on public.master_data_candidate_versions to authenticated;

create or replace function public.review_master_data_candidate(
  target_candidate_id uuid,target_event_key text,target_action text,target_reason text default null
) returns public.master_data_candidates
language plpgsql security definer set search_path=public as $$
declare source_row public.master_data_candidates; result public.master_data_candidates; bank_row public.master_bank_accounts;
begin
  select * into source_row from public.master_data_candidates where id=target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if target_action not in ('approve','reject','archive','restore','keep_existing','match_master','request_info','lock','controlled_correction') then raise exception 'master_candidate_action_invalid'; end if;
  if target_action in ('approve','reject','keep_existing','match_master','request_info','lock','controlled_correction') and nullif(btrim(target_reason),'') is null then raise exception 'master_candidate_reason_required'; end if;
  if target_action in ('approve','lock') and (source_row.source_table is null or source_row.source_id is null) then raise exception 'master_candidate_source_required'; end if;
  if target_action='approve' and source_row.status<>'pending_review' then raise exception 'master_candidate_not_pending'; end if;
  if target_action='approve' and source_row.entity_type='bank_account' then
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(source_row.company_id,'other',source_row.display_name,source_row.normalized_name,source_row.candidate_data->>'bank_name',source_row.candidate_data->>'account_last4','verified',source_row.source_table,source_row.source_id,auth.uid(),now(),auth.uid())
    on conflict do nothing returning * into bank_row;
  elsif target_action='match_master' and source_row.entity_type='bank_account' then
    select * into bank_row from public.master_bank_accounts account
    where account.company_id=source_row.company_id and account.verification_status<>'archived'
      and account.normalized_owner_name=source_row.normalized_name
      and account.account_last4=source_row.candidate_data->>'account_last4'
    order by account.updated_at desc limit 1;
    if bank_row.id is null then raise exception 'master_candidate_match_not_found'; end if;
  end if;
  update public.master_data_candidates set
    status=case target_action when 'approve' then 'confirmed' when 'match_master' then 'confirmed' when 'reject' then 'rejected' when 'keep_existing' then 'confirmed' when 'request_info' then 'needs_review' when 'lock' then 'locked' when 'controlled_correction' then 'needs_review' when 'archive' then 'archived' when 'restore' then 'needs_review' end,
    review_reason=nullif(btrim(target_reason),''),reviewed_by=auth.uid(),reviewed_at=now(),archived_at=case when target_action='archive' then now() else null end,updated_at=now()
  where id=source_row.id returning * into result;
  insert into public.master_data_audit(company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,bank_row.id,target_event_key,'candidate_'||target_action,auth.uid(),to_jsonb(source_row),to_jsonb(result),nullif(btrim(target_reason),''));
  insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
  select result.company_id,result.id,coalesce(max(version_no),0)+1,result.status,to_jsonb(result),result.source_table,result.source_id,target_event_key,auth.uid()
  from public.master_data_candidate_versions where candidate_id=result.id;
  return result;
end;
$$;

revoke all on function public.review_master_data_candidate(uuid,text,text,text) from public,anon;
grant execute on function public.review_master_data_candidate(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';

;


