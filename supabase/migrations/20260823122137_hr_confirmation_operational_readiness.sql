-- Local-first operational readiness for HR Confirmation Bundle.
-- Production remains out of scope until local migration/RLS/browser verification passes.

alter table public.hr_confirmation_bundles
  add column owner_profile_id uuid references public.profiles(id) on delete set null,
  add column next_action text not null default 'review' check (next_action in (
    'review','request_information','approve','record_attendance','close_job','none'
  )),
  add column sla_due_at timestamptz,
  add column escalation_level smallint not null default 0 check (escalation_level between 0 and 3),
  add column escalated_at timestamptz;

create index hr_confirmation_bundle_sla_idx
  on public.hr_confirmation_bundles(company_id,status,sla_due_at)
  where status not in ('closed','cancelled');

create table public.hr_confirmation_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bundle_id uuid not null references public.hr_confirmation_bundles(id) on delete cascade,
  bundle_item_id uuid references public.hr_confirmation_bundle_items(id) on delete cascade,
  source_kind text not null check (source_kind in ('message','attachment','document','attendance_job','attendance_session','hr_summary')),
  source_ref text not null,
  source_message_id uuid references public.chat_messages(id) on delete restrict,
  document_flow_item_id uuid,
  attendance_job_id uuid references public.chat_attendance_approval_jobs(id) on delete restrict,
  attendance_session_id uuid references public.attendance_sessions(id) on delete restrict,
  attachment_bucket text,
  attachment_path text,
  attachment_name text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(company_id,bundle_id,source_kind,source_ref)
);

create index hr_confirmation_evidence_bundle_idx
  on public.hr_confirmation_evidence(company_id,bundle_id,created_at);

alter table public.hr_confirmation_evidence enable row level security;
create policy "HR confirmation owner or manager reads evidence"
on public.hr_confirmation_evidence for select to authenticated
using (
  hr_confirmation_evidence.company_id=public.current_company_id()
  and exists (
    select 1 from public.hr_confirmation_bundles bundle
    where bundle.id=hr_confirmation_evidence.bundle_id
      and bundle.company_id=hr_confirmation_evidence.company_id
      and (bundle.employee_profile_id=auth.uid() or public.is_company_manager(bundle.company_id))
  )
);
revoke insert,update,delete on public.hr_confirmation_evidence from anon,authenticated;
grant select on public.hr_confirmation_evidence to authenticated;

create or replace function public.sync_hr_confirmation_evidence(target_bundle_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare inserted_count integer:=0; row_value record; raw_value record; message_value record;
begin
  for row_value in
    select item.*,job.attendance_session_id,job.selfie_path,job.validation_result,job.device_info
    from public.hr_confirmation_bundle_items item
    left join public.chat_attendance_approval_jobs job on job.id=item.attendance_job_id
    where item.bundle_id=target_bundle_id
  loop
    if row_value.attendance_job_id is not null then
      insert into public.hr_confirmation_evidence(
        company_id,bundle_id,bundle_item_id,source_kind,source_ref,attendance_job_id,attendance_session_id,evidence_snapshot
      ) values(
        row_value.company_id,row_value.bundle_id,row_value.id,'attendance_job',row_value.attendance_job_id::text,
        row_value.attendance_job_id,row_value.attendance_session_id,
        jsonb_build_object('request_code',row_value.request_code,'action',row_value.action,'requested_at',row_value.requested_at,
          'validation_result',row_value.validation_result,'device_info',row_value.device_info,'selfie_path',row_value.selfie_path)
      ) on conflict(company_id,bundle_id,source_kind,source_ref) do update set
        attendance_session_id=excluded.attendance_session_id,evidence_snapshot=excluded.evidence_snapshot;
      get diagnostics inserted_count=row_count;
    end if;

    for raw_value in
      select raw.* from public.hr_intake_raw_items raw
      where raw.bundle_id=target_bundle_id or raw.attendance_job_id=row_value.attendance_job_id
    loop
      select * into message_value from public.chat_messages message where message.id=raw_value.raw_message_id;
      if raw_value.raw_message_id is not null then
        insert into public.hr_confirmation_evidence(
          company_id,bundle_id,bundle_item_id,source_kind,source_ref,source_message_id,attendance_job_id,
          attachment_bucket,attachment_path,attachment_name,evidence_snapshot
        ) values(
          row_value.company_id,row_value.bundle_id,row_value.id,
          case when message_value.attachment_path is null then 'message' else 'attachment' end,
          raw_value.raw_message_id::text,raw_value.raw_message_id,row_value.attendance_job_id,
          message_value.attachment_bucket,message_value.attachment_path,message_value.attachment_name,
          jsonb_build_object('text',raw_value.content_snapshot,'channel',raw_value.source_channel,'source_ref',raw_value.source_ref,
            'classification_reason',raw_value.classification_reason,'confidence',raw_value.confidence)
        ) on conflict(company_id,bundle_id,source_kind,source_ref) do nothing;
      end if;
      if nullif(raw_value.extracted_payload->>'document_flow_item_id','') is not null then
        insert into public.hr_confirmation_evidence(
          company_id,bundle_id,bundle_item_id,source_kind,source_ref,document_flow_item_id,attendance_job_id,evidence_snapshot
        ) values(
          row_value.company_id,row_value.bundle_id,row_value.id,'document',raw_value.extracted_payload->>'document_flow_item_id',
          (raw_value.extracted_payload->>'document_flow_item_id')::uuid,row_value.attendance_job_id,raw_value.extracted_payload
        ) on conflict(company_id,bundle_id,source_kind,source_ref) do nothing;
      end if;
    end loop;
  end loop;
  return inserted_count;
end $$;

create or replace function public.refresh_hr_confirmation_operational_gate(target_bundle_id uuid)
returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare bundle public.hr_confirmation_bundles; item_count integer; evidence_job_count integer; session_count integer; target_owner uuid;
begin
  bundle:=public.refresh_hr_confirmation_bundle(target_bundle_id);
  perform public.sync_hr_confirmation_evidence(target_bundle_id);
  select count(*) into item_count from public.hr_confirmation_bundle_items
  where bundle_id=target_bundle_id and attendance_job_id is not null;
  select count(distinct attendance_job_id),count(distinct attendance_session_id)
  into evidence_job_count,session_count from public.hr_confirmation_evidence where bundle_id=target_bundle_id;
  select member.profile_id into target_owner from public.company_members member
  where member.company_id=bundle.company_id and member.active
    and member.company_role in ('accounting_hr','company_admin','executive','manager')
  order by case member.company_role when 'accounting_hr' then 1 when 'company_admin' then 2 when 'manager' then 3 else 4 end,member.created_at limit 1;
  update public.hr_confirmation_bundles set
    owner_profile_id=coalesce(owner_profile_id,target_owner,responsible_profile_id),
    responsible_profile_id=coalesce(responsible_profile_id,target_owner),
    next_action=case status
      when 'received' then 'review' when 'under_review' then 'review' when 'needs_more_info' then 'request_information'
      when 'pending_approval' then 'approve' when 'approved' then 'record_attendance' when 'recorded' then 'close_job' else 'none' end,
    sla_due_at=case when status in ('closed','cancelled') then null
      when sla_due_at is not null then sla_due_at
      when status='needs_more_info' then now()+interval '4 hours' else now()+interval '30 minutes' end,
    validation_summary=validation_summary||jsonb_build_object(
      'evidence_attendance_job_count',evidence_job_count,'evidence_attendance_session_count',session_count,
      'evidence_complete',item_count>0 and evidence_job_count=item_count
    ),updated_at=now(),version=version+1
  where id=target_bundle_id returning * into bundle;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
  values(bundle.company_id,bundle.id,'operational_gate_refreshed',bundle.status,bundle.status,
    jsonb_build_object('owner_profile_id',bundle.owner_profile_id,'next_action',bundle.next_action,'sla_due_at',bundle.sla_due_at,
      'evidence_job_count',evidence_job_count,'item_count',item_count));
  return bundle;
end $$;

create or replace function public.enforce_hr_confirmation_operational_gate()
returns trigger language plpgsql security definer set search_path=public as $$
declare item_count integer; evidence_job_count integer; evidence_session_count integer;
begin
  if new.status=old.status then return new; end if;
  new.next_action:=case new.status
    when 'received' then 'review' when 'under_review' then 'review' when 'needs_more_info' then 'request_information'
    when 'pending_approval' then 'approve' when 'approved' then 'record_attendance' when 'recorded' then 'close_job' else 'none' end;
  new.sla_due_at:=case when new.status in ('closed','cancelled') then null
    when new.status='needs_more_info' then now()+interval '4 hours' else now()+interval '30 minutes' end;
  if new.status not in ('approved','closed') then return new; end if;
  perform public.sync_hr_confirmation_evidence(new.id);
  select count(*) into item_count from public.hr_confirmation_bundle_items item
  where item.bundle_id=new.id and item.attendance_job_id is not null;
  select count(distinct evidence.attendance_job_id),count(distinct evidence.attendance_session_id)
  into evidence_job_count,evidence_session_count from public.hr_confirmation_evidence evidence where evidence.bundle_id=new.id;
  if new.owner_profile_id is null or item_count=0 or evidence_job_count<>item_count then
    raise exception 'hr_confirmation_operational_evidence_gate_failed';
  end if;
  if new.status='closed' and evidence_session_count<>item_count then
    raise exception 'hr_confirmation_attendance_evidence_incomplete';
  end if;
  return new;
end $$;

create or replace function public.assign_hr_confirmation_bundle(
  target_bundle_id uuid,target_owner_profile_id uuid,target_action_key text
) returns public.hr_confirmation_bundles
language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); bundle public.hr_confirmation_bundles; previous_owner uuid;
begin
  select * into bundle from public.hr_confirmation_bundles where id=target_bundle_id for update;
  if not found then raise exception 'hr_confirmation_bundle_not_found'; end if;
  if actor_id is null or not public.is_company_manager(bundle.company_id) then raise exception 'hr_confirmation_manager_required'; end if;
  if nullif(trim(coalesce(target_action_key,'')),'') is null then raise exception 'hr_confirmation_action_key_required'; end if;
  if not exists(select 1 from public.company_members member where member.company_id=bundle.company_id and member.profile_id=target_owner_profile_id and member.active) then
    raise exception 'hr_confirmation_owner_company_mismatch';
  end if;
  if exists(select 1 from public.hr_confirmation_bundle_events event where event.bundle_id=bundle.id and event.action_key=trim(target_action_key)) then return bundle; end if;
  previous_owner:=bundle.owner_profile_id;
  update public.hr_confirmation_bundles set owner_profile_id=target_owner_profile_id,responsible_profile_id=target_owner_profile_id,updated_at=now(),version=version+1
  where id=bundle.id returning * into bundle;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,actor_profile_id,event_type,from_status,to_status,action_key,details)
  values(bundle.company_id,bundle.id,actor_id,'owner_assigned',bundle.status,bundle.status,trim(target_action_key),
    jsonb_build_object('previous_owner',previous_owner,'owner_profile_id',target_owner_profile_id));
  return bundle;
end $$;

create or replace function public.escalate_overdue_hr_confirmation_bundles()
returns integer language plpgsql security definer set search_path=public as $$
declare actor_id uuid:=auth.uid(); affected integer;
begin
  if actor_id is not null and not public.is_company_manager(public.current_company_id()) then raise exception 'hr_confirmation_manager_required'; end if;
  update public.hr_confirmation_bundles bundle set
    escalation_level=least(bundle.escalation_level+1,3),escalated_at=now(),
    sla_due_at=now()+case when bundle.status='needs_more_info' then interval '4 hours' else interval '30 minutes' end,
    updated_at=now(),version=version+1
  where bundle.status not in ('closed','cancelled') and bundle.sla_due_at<=now()
    and (actor_id is null or bundle.company_id=public.current_company_id());
  get diagnostics affected=row_count;
  insert into public.hr_confirmation_bundle_events(company_id,bundle_id,event_type,from_status,to_status,details)
  select bundle.company_id,bundle.id,'sla_escalated',bundle.status,bundle.status,
    jsonb_build_object('escalation_level',bundle.escalation_level,'next_sla_due_at',bundle.sla_due_at)
  from public.hr_confirmation_bundles bundle where bundle.escalated_at>=now()-interval '5 seconds';
  return affected;
end $$;

create or replace function public.get_hr_confirmation_daily_summary(target_date date default current_date)
returns jsonb language sql security definer set search_path=public as $$
  select case when auth.uid() is null or public.current_company_id() is null or not public.is_company_manager(public.current_company_id())
    then '{}'::jsonb else jsonb_build_object(
      'date',target_date,'total',count(*),'pending_review',count(*) filter(where status in ('received','under_review')),
      'needs_more_info',count(*) filter(where status='needs_more_info'),'pending_approval',count(*) filter(where status='pending_approval'),
      'recorded',count(*) filter(where status='recorded'),'closed',count(*) filter(where status='closed'),
      'overdue',count(*) filter(where status not in ('closed','cancelled') and sla_due_at<=now()),
      'escalated',count(*) filter(where escalation_level>0)
    ) end
  from public.hr_confirmation_bundles
  where company_id=public.current_company_id() and work_date=target_date
$$;

create or replace function public.refresh_hr_confirmation_operational_trigger_function()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.refresh_hr_confirmation_operational_gate(new.bundle_id);
  return new;
end $$;

drop trigger if exists refresh_hr_confirmation_operational_trigger on public.hr_confirmation_bundle_items;
create trigger refresh_hr_confirmation_operational_trigger after insert on public.hr_confirmation_bundle_items
for each row execute function public.refresh_hr_confirmation_operational_trigger_function();
drop trigger if exists enforce_hr_confirmation_operational_gate_trigger on public.hr_confirmation_bundles;
create trigger enforce_hr_confirmation_operational_gate_trigger before update of status on public.hr_confirmation_bundles
for each row execute function public.enforce_hr_confirmation_operational_gate();

revoke all on function public.sync_hr_confirmation_evidence(uuid) from public,anon,authenticated;
revoke all on function public.refresh_hr_confirmation_operational_gate(uuid) from public,anon,authenticated;
revoke all on function public.refresh_hr_confirmation_operational_trigger_function() from public,anon,authenticated;
revoke all on function public.enforce_hr_confirmation_operational_gate() from public,anon,authenticated;
revoke all on function public.assign_hr_confirmation_bundle(uuid,uuid,text) from public,anon;
revoke all on function public.escalate_overdue_hr_confirmation_bundles() from public,anon;
revoke all on function public.get_hr_confirmation_daily_summary(date) from public,anon;
grant execute on function public.sync_hr_confirmation_evidence(uuid),public.refresh_hr_confirmation_operational_gate(uuid) to service_role;
grant execute on function public.assign_hr_confirmation_bundle(uuid,uuid,text),public.escalate_overdue_hr_confirmation_bundles(),public.get_hr_confirmation_daily_summary(date) to authenticated,service_role;

-- Existing local bundles are reconciled without modifying attendance or deleting raw intake.
do $$ declare bundle_value record; begin
  for bundle_value in select id from public.hr_confirmation_bundles order by created_at loop
    perform public.refresh_hr_confirmation_operational_gate(bundle_value.id);
  end loop;
end $$;

notify pgrst,'reload schema';

;


