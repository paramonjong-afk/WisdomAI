-- ATT-FALLBACK-001: complete Telegram GPS + selfie attendance safely and atomically.
create or replace function public.finalize_telegram_attendance_request(target_request_id uuid)
returns table(session_id uuid, result_status text, distance_meters double precision)
language plpgsql security definer set search_path=public as $$
declare
  req public.attendance_channel_requests;
  site public.project_sites;
  open_session public.attendance_sessions;
  distance_value double precision;
  attendance_status text;
  saved_session_id uuid;
begin
  if current_user not in ('service_role','postgres') then raise exception 'service_role_required'; end if;
  select * into req from public.attendance_channel_requests where id=target_request_id for update;
  if req.id is null or req.channel<>'telegram' then raise exception 'telegram_request_not_found'; end if;
  if req.status not in ('information_required','awaiting_confirmation') then raise exception 'request_not_actionable'; end if;
  if req.requested_at < now()-interval '10 minutes' then
    update public.attendance_channel_requests set status='expired',updated_at=now() where id=req.id;
    raise exception 'request_expired';
  end if;
  if req.profile_id is null or req.latitude is null or req.longitude is null or req.selfie_path is null or req.site_id is null then
    raise exception 'request_information_incomplete';
  end if;
  if not exists(select 1 from public.company_members m where m.company_id=req.company_id and m.profile_id=req.profile_id and m.active) then
    raise exception 'employee_not_in_request_company';
  end if;
  select * into site from public.project_sites s where s.id=req.site_id and s.company_id=req.company_id and s.active;
  if site.id is null then raise exception 'site_not_in_request_company'; end if;
  distance_value:=6371000*2*asin(sqrt(power(sin(radians(req.latitude-site.latitude)/2),2)+cos(radians(site.latitude))*cos(radians(req.latitude))*power(sin(radians(req.longitude-site.longitude)/2),2)));
  attendance_status:=case when distance_value<=site.radius_meters and coalesce(req.accuracy_meters,0)<=100 then 'normal' else 'needs_review' end;

  if req.action='clock_in' then
    insert into public.attendance_sessions(company_id,profile_id,site_id,clock_in_at,clock_in_latitude,clock_in_longitude,clock_in_accuracy_meters,clock_in_distance_meters,clock_in_selfie_path,status,review_reason,review_category,review_requested_at,review_channel)
    values(req.company_id,req.profile_id,site.id,req.requested_at,req.latitude,req.longitude,req.accuracy_meters,distance_value,req.selfie_path,attendance_status,
      case when attendance_status='needs_review' then 'Telegram GPS/Selfie requires review' end,
      case when attendance_status='needs_review' then 'gps_outside' end,
      case when attendance_status='needs_review' then now() end,
      case when attendance_status='needs_review' then 'telegram' end)
    returning id into saved_session_id;
  else
    select * into open_session from public.attendance_sessions s
      where s.company_id=req.company_id and s.profile_id=req.profile_id and s.clock_out_at is null and s.status not in ('rejected','duplicate')
      order by s.clock_in_at desc limit 1 for update;
    if open_session.id is null then raise exception 'open_attendance_not_found'; end if;
    update public.attendance_sessions set clock_out_at=req.requested_at,clock_out_latitude=req.latitude,clock_out_longitude=req.longitude,
      clock_out_accuracy_meters=req.accuracy_meters,clock_out_distance_meters=distance_value,clock_out_selfie_path=req.selfie_path,
      status=case when status='needs_review' or attendance_status='needs_review' then 'needs_review' else 'normal' end,
      review_reason=case when status='needs_review' or attendance_status='needs_review' then concat_ws(' · ',review_reason,'Telegram GPS/Selfie requires review') else review_reason end,
      review_category=case when status='needs_review' or attendance_status='needs_review' then 'multiple' else review_category end,
      review_requested_at=case when status='needs_review' or attendance_status='needs_review' then now() else review_requested_at end,
      review_channel=case when status='needs_review' or attendance_status='needs_review' then 'telegram' else review_channel end,
      updated_at=now() where id=open_session.id returning id into saved_session_id;
  end if;

  update public.attendance_channel_requests set attendance_session_id=saved_session_id,missing_fields='{}',
    status=case when attendance_status='needs_review' then 'pending_review' else 'approved' end,confirmed_at=now(),updated_at=now()
    where id=req.id;
  insert into public.attendance_channel_events(company_id,request_id,actor_profile_id,event_type,details)
    values(req.company_id,req.id,req.profile_id,'attendance_created',jsonb_build_object('session_id',saved_session_id,'status',attendance_status,'distance_meters',round(distance_value::numeric,1)));
  return query select saved_session_id,attendance_status,distance_value;
end $$;
revoke all on function public.finalize_telegram_attendance_request(uuid) from public,anon,authenticated;
grant execute on function public.finalize_telegram_attendance_request(uuid) to service_role;

drop policy if exists "Attendance selfies readable by owner or manager" on storage.objects;
create policy "Attendance selfies readable by tenant owner or manager" on storage.objects for select to authenticated using (
  bucket_id='attendance-selfies' and (
    (storage.foldername(name))[1]=auth.uid()::text
    or exists(select 1 from public.company_members m where m.company_id=public.current_company_id() and m.profile_id::text=(storage.foldername(name))[1] and m.active and public.is_company_manager(m.company_id))
  )
);

update public.system_work_items set status='doing',progress=55,
  detail='Telegram fallback accepts short-lived GPS and selfie evidence, stores tenant-safe media, and atomically creates or reviews attendance.',
  production_status='migration_ready_for_production',updated_at=now()
where work_key='ATT-FALLBACK-001';
