-- Close open duplicate Candidates when one canonical Candidate is confirmed.
-- Raw/OCR/source rows are retained. Each closed sibling keeps duplicate_of,
-- an append-only Version and an Audit event for recovery.

create or replace function public.reconcile_confirmed_master_duplicate_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sibling public.master_data_candidates;
  before_row jsonb;
  group_account_last4 text;
  audit_key text;
begin
  if new.status not in ('confirmed','approved','locked')
     or old.status = new.status then
    return new;
  end if;

  group_account_last4 := public.normalize_master_data_account_last4(new.candidate_data->>'account_last4');
  if nullif(new.normalized_name,'') is null or group_account_last4 is null then
    return new;
  end if;

  for sibling in
    select candidate.*
    from public.master_data_candidates candidate
    where candidate.company_id = new.company_id
      and candidate.entity_type = new.entity_type
      and candidate.id <> new.id
      and candidate.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed')
      and candidate.normalized_name = new.normalized_name
      and public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4') = group_account_last4
    for update
  loop
    before_row := to_jsonb(sibling);
    audit_key := 'master-duplicate-reconcile:' || new.id::text || ':' || sibling.id::text;

    update public.master_data_candidates
    set status = 'archived',
        duplicate_of = new.id,
        review_reason = 'ปิดอัตโนมัติ: ข้อมูลชื่อและเลขท้ายบัญชีตรงกับ Candidate ที่ยืนยันแล้ว ' || new.id::text,
        reviewed_by = coalesce(new.reviewed_by, sibling.reviewed_by),
        reviewed_at = coalesce(new.reviewed_at, now()),
        archived_at = now(),
        candidate_data = sibling.candidate_data || jsonb_build_object(
          'duplicate_reconciled_to', new.id,
          'duplicate_reconciled_at', now(),
          'duplicate_reconcile_reason', 'normalized_name_and_account_last4_match'
        ),
        updated_at = now()
    where id = sibling.id
    returning * into sibling;

    insert into public.master_data_audit(
      company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason
    ) values (
      sibling.company_id,sibling.id,audit_key,'candidate_duplicate_group_reconciled',
      coalesce(new.reviewed_by,sibling.reviewed_by),before_row,to_jsonb(sibling),
      'ยืนยัน Candidate หลักแล้ว จึงนำหลักฐานซ้ำออกจาก Review Queue โดยไม่ลบ Source'
    ) on conflict(event_key) do nothing;

    insert into public.master_data_candidate_versions(
      company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by
    ) values (
      sibling.company_id,sibling.id,
      (select coalesce(max(version.version_no),0)+1 from public.master_data_candidate_versions version where version.candidate_id=sibling.id),
      sibling.status,to_jsonb(sibling),sibling.source_table,sibling.source_id,audit_key,
      coalesce(new.reviewed_by,sibling.reviewed_by)
    );
  end loop;

  return new;
end;
$$;

revoke all on function public.reconcile_confirmed_master_duplicate_group() from public,anon,authenticated;

drop trigger if exists reconcile_confirmed_master_duplicate_group_after_status on public.master_data_candidates;
create trigger reconcile_confirmed_master_duplicate_group_after_status
after update of status on public.master_data_candidates
for each row execute function public.reconcile_confirmed_master_duplicate_group();

-- Reconcile historical open siblings using the latest confirmed canonical row
-- in each exact company/entity/name/account-last4 group.
do $$
declare
  canonical public.master_data_candidates;
  sibling public.master_data_candidates;
  before_row jsonb;
  audit_key text;
begin
  for canonical in
    select distinct on (
      candidate.company_id,candidate.entity_type,candidate.normalized_name,
      public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4')
    ) candidate.*
    from public.master_data_candidates candidate
    where candidate.status in ('confirmed','approved','locked')
      and nullif(candidate.normalized_name,'') is not null
      and public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4') is not null
    order by candidate.company_id,candidate.entity_type,candidate.normalized_name,
      public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4'),
      candidate.reviewed_at desc nulls last,candidate.created_at desc
  loop
    for sibling in
      select candidate.* from public.master_data_candidates candidate
      where candidate.company_id=canonical.company_id and candidate.entity_type=canonical.entity_type
        and candidate.id<>canonical.id
        and candidate.status in ('provisional','pending_review','auto_verified','needs_review','needs_more_info','admin_reviewed')
        and candidate.normalized_name=canonical.normalized_name
        and public.normalize_master_data_account_last4(candidate.candidate_data->>'account_last4')=
          public.normalize_master_data_account_last4(canonical.candidate_data->>'account_last4')
      for update
    loop
      before_row:=to_jsonb(sibling);
      audit_key:='master-duplicate-reconcile:'||canonical.id::text||':'||sibling.id::text;
      update public.master_data_candidates set status='archived',duplicate_of=canonical.id,
        review_reason='ปิดอัตโนมัติย้อนหลัง: ตรงกับ Candidate ที่ยืนยันแล้ว '||canonical.id::text,
        reviewed_by=coalesce(canonical.reviewed_by,sibling.reviewed_by),reviewed_at=coalesce(canonical.reviewed_at,now()),archived_at=now(),
        candidate_data=sibling.candidate_data||jsonb_build_object('duplicate_reconciled_to',canonical.id,'duplicate_reconciled_at',now(),'duplicate_reconcile_reason','normalized_name_and_account_last4_match'),updated_at=now()
      where id=sibling.id returning * into sibling;
      insert into public.master_data_audit(company_id,candidate_id,event_key,action,actor_profile_id,before_data,after_data,reason)
      values(sibling.company_id,sibling.id,audit_key,'candidate_duplicate_group_reconciled',coalesce(canonical.reviewed_by,sibling.reviewed_by),before_row,to_jsonb(sibling),'Reconcile รายการเดิม: นำหลักฐานซ้ำออกจาก Review Queue โดยไม่ลบ Source')
      on conflict(event_key) do nothing;
      insert into public.master_data_candidate_versions(company_id,candidate_id,version_no,status,data,source_table,source_id,audit_event_key,created_by)
      values(sibling.company_id,sibling.id,(select coalesce(max(version.version_no),0)+1 from public.master_data_candidate_versions version where version.candidate_id=sibling.id),sibling.status,to_jsonb(sibling),sibling.source_table,sibling.source_id,audit_key,coalesce(canonical.reviewed_by,sibling.reviewed_by));
    end loop;
  end loop;
end $$;

notify pgrst,'reload schema';

-- Rollback/recovery: drop only the trigger/function to stop future automatic
-- reconciliation. To reopen a mistaken sibling, an Admin restores its prior
-- status from master_data_audit.before_data and clears duplicate_of in a new
-- audited correction; Raw/OCR/source records never need restoration.
