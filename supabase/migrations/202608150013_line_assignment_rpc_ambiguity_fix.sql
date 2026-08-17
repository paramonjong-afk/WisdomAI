-- LINE-GROUP-APPROVAL-001: PostgreSQL resolves the RETURNS TABLE output
-- variable request_id before an unqualified ON CONFLICT column name. Target
-- the named unique constraint so unknown LINE groups can be quarantined.

create or replace function public.register_unassigned_line_group(
  target_line_group_id text,
  target_display_name text,
  target_source_type text,
  target_webhook_event_id text
)
returns table(request_id uuid, should_notify boolean)
language plpgsql
security definer
set search_path=public
as $$
declare request_row public.line_group_assignment_requests;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role_required';
  end if;
  if nullif(trim(target_line_group_id),'') is null then
    raise exception 'line_group_id_required';
  end if;
  if exists(select 1 from public.line_groups where line_group_id=trim(target_line_group_id)) then
    return;
  end if;

  insert into public.line_group_assignment_requests(
    line_group_id,display_name,source_type,last_seen_at,last_webhook_event_id
  ) values(
    trim(target_line_group_id),nullif(trim(target_display_name),''),
    case when target_source_type='room' then 'room' else 'group' end,
    now(),nullif(trim(target_webhook_event_id),'')
  )
  on conflict(line_group_id) do update set
    display_name=coalesce(nullif(trim(excluded.display_name),''),line_group_assignment_requests.display_name),
    last_seen_at=now(),
    last_webhook_event_id=coalesce(excluded.last_webhook_event_id,line_group_assignment_requests.last_webhook_event_id),
    updated_at=now()
  returning * into request_row;

  insert into public.line_group_assignment_options(request_id,company_id)
  select request_row.id,company.id from public.companies company where company.active=true
  on conflict on constraint line_group_assignment_options_request_id_company_id_key
  do update set expires_at=now()+interval '7 days';

  request_id:=request_row.id;
  should_notify:=request_row.status='pending' and (
    request_row.notification_status in ('pending','failed')
    or request_row.notified_at is null
    or request_row.notified_at < now()-interval '6 hours'
  );
  return next;
end;
$$;

revoke all on function public.register_unassigned_line_group(text,text,text,text) from public,anon,authenticated;
grant execute on function public.register_unassigned_line_group(text,text,text,text) to service_role;

update public.system_work_items
set status='review',progress=99,production_status='deployed',
    detail='RPC ambiguity fixed; awaiting a new LINE group message for end-to-end quarantine UAT',
    evidence=concat_ws(E'\n',nullif(evidence,''),
      'Migration 202608150013 fixes request_id ON CONFLICT ambiguity detected by webhook intake audit.'),
    updated_at=now()
where work_key='LINE-GROUP-APPROVAL-001' and status in ('ready','doing','review');
