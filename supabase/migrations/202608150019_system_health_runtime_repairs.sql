begin;

create or replace function public.get_communication_event_feed(
  target_company_id uuid,
  target_limit integer default 500
)
returns setof public.communication_event_feed
language plpgsql
security definer
set search_path=public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  if target_company_id is null then
    raise exception 'company_required' using errcode='22023';
  end if;
  if not public.is_company_manager(target_company_id) then
    raise exception 'company_manager_required' using errcode='42501';
  end if;

  return query
  select event.*
  from public.communication_event_feed event
  where event.company_id=target_company_id
  order by event.occurred_at desc
  limit greatest(1,least(coalesce(target_limit,500),1000));
end;
$$;

revoke all on function public.get_communication_event_feed(uuid,integer) from public,anon;
grant execute on function public.get_communication_event_feed(uuid,integer) to authenticated;

comment on function public.get_communication_event_feed(uuid,integer) is
  'Tenant-guarded communication feed for company managers and platform admins. SECURITY DEFINER only bridges source-table grants after explicit company authorization.';

update public.system_work_items
set status='doing',
    progress=95,
    production_status='awaiting_approval_system_health_runtime_repairs',
    current_step='รออนุมัติ Migration 202608150019 และ Deploy Web/image-storage-optimizer',
    detail='แก้ Error จาก prompt() ด้วย Audit Dialog, แก้ Communication Feed 500 ผ่าน tenant-guarded RPC และนำ ImageMagick WASM ออกจาก Edge Function เพื่อแก้ HTTP 546',
    updated_at=now()
where work_key='SYS-004'
  and status<>'done';

commit;
