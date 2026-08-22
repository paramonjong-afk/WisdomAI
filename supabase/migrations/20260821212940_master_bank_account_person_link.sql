-- When a bank-account candidate is approved, attach it to the existing
-- employee master only when its normalized owner name matches exactly once.
-- Ambiguous or unknown names remain an "other" verified account for Admin to
-- resolve later; the system never guesses a person.
create or replace function public.review_master_data_candidate(
  target_candidate_id uuid,target_event_key text,target_action text,target_reason text default null
) returns public.master_data_candidates
language plpgsql security definer set search_path=public as $$
declare source_row public.master_data_candidates; result public.master_data_candidates; bank_row public.master_bank_accounts;
  matched_profile_id uuid; matched_person_id uuid; profile_matches integer:=0; person_matches integer:=0; resolved_owner_type text:='other';
begin
  select * into source_row from public.master_data_candidates where id=target_candidate_id for update;
  if source_row.id is null or not public.is_company_manager(source_row.company_id) then raise exception 'master_candidate_not_found_or_denied'; end if;
  if target_action not in ('approve','reject','archive','restore') then raise exception 'master_candidate_action_invalid'; end if;
  if target_action='approve' and source_row.status<>'pending_review' then raise exception 'master_candidate_not_pending'; end if;
  if target_action='approve' and source_row.entity_type='bank_account' then
    select count(*), min(employment.profile_id) into profile_matches, matched_profile_id
    from public.employee_employment_records employment join public.profiles profile on profile.id=employment.profile_id
    where employment.company_id=source_row.company_id and employment.employment_status in ('active','probation','notice')
      and public.normalize_master_data_name(profile.full_name)=source_row.normalized_name;
    select count(*), min(person.id) into person_matches, matched_person_id
    from public.employee_people person
    where person.company_id=source_row.company_id and person.employee_status='active'
      and public.normalize_master_data_name(person.full_name)=source_row.normalized_name;
    if profile_matches=1 and person_matches=0 then resolved_owner_type:='employee';
    elsif profile_matches=0 and person_matches=1 then resolved_owner_type:='employee';
    else matched_profile_id:=null; matched_person_id:=null;
    end if;
    insert into public.master_bank_accounts(company_id,owner_type,owner_name,normalized_owner_name,profile_id,employee_person_id,bank_name,account_last4,verification_status,evidence_source_table,evidence_source_id,verified_by,verified_at,created_by)
    values(source_row.company_id,resolved_owner_type,source_row.display_name,source_row.normalized_name,matched_profile_id,matched_person_id,source_row.candidate_data->>'bank_name',source_row.candidate_data->>'account_last4','verified',source_row.source_table,source_row.source_id,auth.uid(),now(),auth.uid())
    on conflict do nothing returning * into bank_row;
  end if;
  update public.master_data_candidates set
    status=case target_action when 'approve' then 'approved' when 'reject' then 'rejected' when 'archive' then 'archived' when 'restore' then 'pending_review' end,
    review_reason=nullif(btrim(target_reason),''),reviewed_by=auth.uid(),reviewed_at=now(),archived_at=case when target_action='archive' then now() else null end,updated_at=now()
  where id=source_row.id returning * into result;
  insert into public.master_data_audit(company_id,candidate_id,bank_account_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(result.company_id,result.id,bank_row.id,target_event_key,'candidate_'||target_action,auth.uid(),to_jsonb(source_row),to_jsonb(result),nullif(btrim(target_reason),''));
  return result;
end;
$$;

-- Enrich previously approved accounts only when the relationship is exact and
-- currently unset; nothing ambiguous is changed.
with profile_matches as (
  select account.id account_id, (array_agg(employment.profile_id order by employment.profile_id))[1] profile_id
  from public.master_bank_accounts account join public.employee_employment_records employment on employment.company_id=account.company_id
  join public.profiles profile on profile.id=employment.profile_id
  where account.profile_id is null and account.employee_person_id is null and account.verification_status='verified'
    and employment.employment_status in ('active','probation','notice') and public.normalize_master_data_name(profile.full_name)=account.normalized_owner_name
  group by account.id having count(*)=1
)
update public.master_bank_accounts account set profile_id=profile_matches.profile_id,owner_type='employee',updated_at=now()
from profile_matches where account.id=profile_matches.account_id;

with person_matches as (
  select account.id account_id, (array_agg(person.id order by person.id))[1] person_id
  from public.master_bank_accounts account join public.employee_people person on person.company_id=account.company_id
  where account.profile_id is null and account.employee_person_id is null and account.verification_status='verified'
    and person.employee_status='active' and public.normalize_master_data_name(person.full_name)=account.normalized_owner_name
  group by account.id having count(*)=1
)
update public.master_bank_accounts account set employee_person_id=person_matches.person_id,owner_type='employee',updated_at=now()
from person_matches where account.id=person_matches.account_id;

notify pgrst,'reload schema';
