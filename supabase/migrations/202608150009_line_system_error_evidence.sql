-- Separate software-error screenshots received through LINE from site issues.
insert into public.image_purpose_catalog(code,name_th,description,active,sort_order)
values('system_error','ผู้ใช้แจ้ง Error ระบบ','ภาพหน้าจอหรือหลักฐานปัญหาโปรแกรมที่ผู้ใช้ส่งผ่าน LINE',true,25)
on conflict(code) do update set name_th=excluded.name_th,description=excluded.description,active=true,sort_order=excluded.sort_order,updated_at=now();

create or replace function public.register_reviewed_system_error_image(target_case_id uuid,target_note text default null)
returns public.system_error_events
language plpgsql security definer set search_path=public as $$
declare
  company uuid:=public.current_company_id();
  review_row public.image_review_cases;
  error_payload jsonb;
  error_code text;
  visible_message text;
  affected_module text;
  result public.system_error_events;
begin
  if company is null or not public.is_company_manager(company) then raise exception 'manager access required'; end if;
  select * into review_row from public.image_review_cases
  where id=target_case_id and company_id=company for update;
  if review_row.id is null then raise exception 'image review not found'; end if;
  if review_row.review_status not in ('confirmed','corrected') or review_row.confirmed_primary_purpose<>'system_error' then
    raise exception 'image must be confirmed as system_error first';
  end if;

  error_payload:=coalesce(review_row.confirmed_output,review_row.proposed_output,'{}'::jsonb)->'system_error';
  error_code:=nullif(trim(coalesce(error_payload->>'error_code','')),'');
  visible_message:=coalesce(
    nullif(trim(coalesce(error_payload->>'visible_message','')),''),
    nullif(trim(coalesce(target_note,'')),''),
    'ผู้ใช้ส่งภาพแจ้ง Error ระบบผ่าน LINE'
  );
  affected_module:=coalesce(nullif(trim(coalesce(error_payload->>'affected_module','')),''),'unknown_module');

  select * into result from public.upsert_system_error_event(
    company,
    'line-image:'||substr(md5(review_row.source_message_id::text||'|'||coalesce(error_code,affected_module)),1,24),
    lower(affected_module||'|'||coalesce(error_code,'visible_error')||'|'||visible_message),
    'line_user_screenshot',
    'ผู้ใช้แจ้ง Error ระบบ: '||affected_module,
    visible_message,
    affected_module,
    'error',
    jsonb_build_object('error_code',error_code,'review_case_id',review_row.id,'confirmed_by',auth.uid()),
    review_row.source_message_id,
    true
  );
  return result;
end $$;
revoke all on function public.register_reviewed_system_error_image(uuid,text) from public,anon;
grant execute on function public.register_reviewed_system_error_image(uuid,text) to authenticated;

notify pgrst,'reload schema';
