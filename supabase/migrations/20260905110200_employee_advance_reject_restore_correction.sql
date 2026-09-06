-- Re-versioned after the Production history baseline; reversible exclusion for incorrectly classified advance cases.
-- The source slip, transaction, settlement lines and audit history are retained.

alter table public.employee_advance_cases
  add column if not exists rejected_reason_code text,
  add column if not exists rejected_reason_note text,
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz;

alter table public.employee_advance_cases drop constraint if exists employee_advance_cases_status_check;
alter table public.employee_advance_cases add constraint employee_advance_cases_status_check
  check(status in ('draft','collecting_evidence','submitted','under_review','approved','settlement_required','closed','returned','cancelled','rejected'));

alter table public.employee_advance_cases drop constraint if exists employee_advance_cases_rejected_reason_check;
alter table public.employee_advance_cases add constraint employee_advance_cases_rejected_reason_check check (
  status <> 'rejected' or (
    rejected_reason_code in ('wrong_amount','duplicate','not_advance','wrong_type','other')
    and length(btrim(coalesce(rejected_reason_note,''))) >= 3
    and rejected_at is not null
  )
);

create or replace function public.reject_employee_advance_case(
  target_case_id uuid,
  target_event_key text,
  target_expected_version integer,
  target_reason_code text,
  target_reason_note text
) returns public.employee_advance_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.employee_advance_cases;
  result public.employee_advance_cases;
begin
  if auth.uid() is null then raise exception 'advance_reject_auth_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'advance_reject_event_key_required'; end if;

  select * into before_row from public.employee_advance_cases where id=target_case_id for update;
  if before_row.id is null or not (public.is_platform_admin() or public.is_company_manager(before_row.company_id)) then
    raise exception 'advance_case_not_found_or_denied';
  end if;
  if exists(select 1 from public.employee_advance_audit where event_key=target_event_key) then return before_row; end if;
  if before_row.version<>target_expected_version then raise exception 'advance_version_conflict'; end if;
  if before_row.status='closed' then raise exception 'advance_final_requires_adjustment'; end if;
  if before_row.status='rejected' then raise exception 'advance_already_rejected'; end if;
  if target_reason_code not in ('wrong_amount','duplicate','not_advance','wrong_type','other') or length(btrim(coalesce(target_reason_note,'')))<3 then
    raise exception 'advance_reject_reason_required';
  end if;
  if exists(
    select 1 from public.employee_advance_cases child
    where child.parent_case_id=before_row.id and child.status not in ('closed','cancelled','rejected')
  ) then raise exception 'advance_reject_active_children'; end if;

  update public.employee_advance_cases set
    status='rejected',rejected_reason_code=target_reason_code,rejected_reason_note=btrim(target_reason_note),
    rejected_by=auth.uid(),rejected_at=now(),version=version+1,updated_at=now()
  where id=before_row.id returning * into result;

  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(before_row.id,before_row.company_id,target_event_key,'reject_exclude_from_totals',auth.uid(),to_jsonb(before_row),to_jsonb(result),btrim(target_reason_note));
  return result;
end;
$$;

create or replace function public.restore_employee_advance_case(
  target_case_id uuid,
  target_event_key text,
  target_expected_version integer,
  target_reason text
) returns public.employee_advance_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.employee_advance_cases;
  result public.employee_advance_cases;
begin
  if auth.uid() is null then raise exception 'advance_restore_auth_required'; end if;
  if nullif(btrim(target_event_key),'') is null then raise exception 'advance_restore_event_key_required'; end if;
  select * into before_row from public.employee_advance_cases where id=target_case_id for update;
  if before_row.id is null or not (public.is_platform_admin() or public.is_company_manager(before_row.company_id)) then
    raise exception 'advance_case_not_found_or_denied';
  end if;
  if exists(select 1 from public.employee_advance_audit where event_key=target_event_key) then return before_row; end if;
  if before_row.version<>target_expected_version then raise exception 'advance_version_conflict'; end if;
  if before_row.status<>'rejected' then raise exception 'advance_restore_only_rejected'; end if;
  if length(btrim(coalesce(target_reason,'')))<3 then raise exception 'advance_restore_reason_required'; end if;

  update public.employee_advance_cases set
    status='draft',rejected_reason_code=null,rejected_reason_note=null,rejected_by=null,rejected_at=null,
    version=version+1,updated_at=now()
  where id=before_row.id returning * into result;
  insert into public.employee_advance_audit(case_id,company_id,event_key,action,actor_profile_id,before_data,after_data,reason)
  values(before_row.id,before_row.company_id,target_event_key,'restore_to_review',auth.uid(),to_jsonb(before_row),to_jsonb(result),btrim(target_reason));
  return result;
end;
$$;

revoke all on function public.reject_employee_advance_case(uuid,text,integer,text,text), public.restore_employee_advance_case(uuid,text,integer,text) from public,anon;
grant execute on function public.reject_employee_advance_case(uuid,text,integer,text,text), public.restore_employee_advance_case(uuid,text,integer,text) to authenticated;

notify pgrst,'reload schema';
