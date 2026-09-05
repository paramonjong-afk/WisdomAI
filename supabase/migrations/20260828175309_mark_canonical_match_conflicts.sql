-- Surface Canonical ambiguity in the existing classification conflict field.
-- This remains derived metadata; Raw/OCR/source evidence is unchanged.

create or replace function public.append_canonical_match_conflict_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.candidate_data->>'canonical_match_status' = 'conflict'
     and not coalesce(new.classification_conflicts, '[]'::jsonb) @> '["canonical_match_conflict"]'::jsonb then
    new.classification_conflicts := coalesce(new.classification_conflicts, '[]'::jsonb) || '["canonical_match_conflict"]'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function public.append_canonical_match_conflict_flag() from public,anon,authenticated;

drop trigger if exists zz_append_canonical_match_conflict_flag on public.master_data_candidates;
create trigger zz_append_canonical_match_conflict_flag
before insert or update of candidate_data
on public.master_data_candidates
for each row execute function public.append_canonical_match_conflict_flag();

do $$
declare
  candidate_row public.master_data_candidates;
  result_row public.master_data_candidates;
  before_data jsonb;
  audit_key text;
begin
  for candidate_row in
    select *
    from public.master_data_candidates candidate
    where candidate.candidate_data->>'canonical_match_status' = 'conflict'
      and not coalesce(candidate.classification_conflicts, '[]'::jsonb) @> '["canonical_match_conflict"]'::jsonb
    for update
  loop
    before_data := to_jsonb(candidate_row);
    update public.master_data_candidates
    set candidate_data = candidate_data,
        updated_at = now()
    where id = candidate_row.id
    returning * into result_row;

    audit_key := 'master-canonical-conflict-visible:' || result_row.id::text;
    insert into public.master_data_audit(
      company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason
    ) values (
      result_row.company_id,result_row.id,audit_key,'candidate_canonical_conflict_exposed',null,
      before_data,to_jsonb(result_row),'แสดง Canonical ที่ซ้ำหรือขัดแย้งใน Review Queue'
    ) on conflict(event_key) do nothing;
    insert into public.master_data_candidate_versions(
      company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
    ) values (
      result_row.company_id,result_row.id,
      (select coalesce(max(version.version_no),0)+1 from public.master_data_candidate_versions version where version.candidate_id=result_row.id),
      result_row.status,to_jsonb(result_row),result_row.source_table,result_row.source_id,audit_key,null
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
