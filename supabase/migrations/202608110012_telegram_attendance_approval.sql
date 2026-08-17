-- ATT-TELEGRAM-APPROVAL-001: tenant-safe attendance review from linked Telegram admins.
alter table public.attendance_approval_events drop constraint if exists attendance_approval_events_source_check;
alter table public.attendance_approval_events add constraint attendance_approval_events_source_check
  check(source in ('web','line_group','admin','telegram'));

create or replace function public.review_telegram_attendance(
  target_session_id uuid,
  actor_profile_id uuid,
  review_action text
) returns table(session_id uuid,result_status text)
language plpgsql security definer set search_path=public as $$
declare before_row public.attendance_sessions; after_row public.attendance_sessions; reason_text text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service_role_required'; end if;
  if review_action not in ('approve','reject','request_more') then raise exception 'invalid_review_action'; end if;
  select * into before_row from public.attendance_sessions where id=target_session_id for update;
  if before_row.id is null then raise exception 'attendance_not_found'; end if;
  if before_row.status<>'needs_review' then raise exception 'attendance_already_decided'; end if;
  if not exists(select 1 from public.company_members m where m.company_id=before_row.company_id and m.profile_id=actor_profile_id and m.active and m.company_role in ('company_admin','executive','manager')) then
    raise exception 'telegram_admin_not_authorized_for_company';
  end if;
  reason_text:=case review_action when 'approve' then 'อนุมัติผ่าน Telegram' when 'reject' then 'ไม่อนุมัติผ่าน Telegram' else 'ขอข้อมูลเพิ่มผ่าน Telegram' end;
  update public.attendance_sessions set
    status=case review_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_review' end,
    review_reason=case when review_action='approve' then coalesce(review_reason,reason_text) else reason_text end,
    reviewed_by=case when review_action='request_more' then null else actor_profile_id end,
    reviewed_at=case when review_action='request_more' then null else now() end,
    updated_at=now()
  where id=before_row.id returning * into after_row;
  update public.attendance_channel_requests set
    status=case review_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'information_required' end,
    decided_by=actor_profile_id,decided_at=now(),decision_reason=reason_text,updated_at=now()
  where attendance_session_id=before_row.id and company_id=before_row.company_id and channel='telegram';
  insert into public.attendance_approval_events(company_id,session_id,actor_profile_id,source,action,reason,old_status,new_status)
  values(before_row.company_id,before_row.id,actor_profile_id,'telegram',review_action,reason_text,before_row.status,after_row.status);
  return query select after_row.id,after_row.status;
end $$;
revoke all on function public.review_telegram_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_telegram_attendance(uuid,uuid,text) to service_role;

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,production_status)
values('ATT-TELEGRAM-APPROVAL-001','อนุมัติรายการลงเวลาผ่าน Telegram','operations','doing',55,'high','Send tenant-scoped attendance review cards to Telegram admins and process idempotent approval callbacks with audit.','migration_ready_for_production')
on conflict(work_key) do update set status='doing',progress=55,detail=excluded.detail,production_status=excluded.production_status,updated_at=now();
