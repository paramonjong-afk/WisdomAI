-- Action RPCs for the owner-only Program Development command inbox.
create or replace function public.dispatch_program_development_task(
  target_task_id uuid,
  target_target text default 'codex'
)
returns public.development_task_dispatches
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.development_tasks;
  dispatch_row public.development_task_dispatches;
begin
  if target_target not in ('codex','developer_queue') then
    raise exception 'program_development_dispatch_target_invalid';
  end if;
  select * into task_row
  from public.development_tasks
  where id=target_task_id
  for update;
  if task_row.id is null or not public.is_program_development_owner(task_row.company_id) then
    raise exception 'program_development_task_owner_required';
  end if;
  insert into public.development_task_dispatches(company_id,task_id,target,event_key,status)
  values(task_row.company_id,task_row.id,target_target,'program-dev-dispatch:'||task_row.id::text||':'||target_target,'queued')
  on conflict(task_id,target) do update
    set status=case when public.development_task_dispatches.status='sent' then public.development_task_dispatches.status else 'queued' end,
        last_error=null,
        updated_at=now()
  returning * into dispatch_row;
  insert into public.program_development_audit(company_id,task_id,room_id,event_key,action,actor_profile_id,details)
  values(task_row.company_id,task_row.id,task_row.room_id,
    'program-dev-dispatch-action:'||task_row.id::text||':'||target_target,
    'task_dispatched',auth.uid(),jsonb_build_object('target',target_target,'dispatch_id',dispatch_row.id))
  on conflict(event_key) do nothing;
  return dispatch_row;
end $$;

revoke all on function public.dispatch_program_development_task(uuid,text) from public,anon;
grant execute on function public.dispatch_program_development_task(uuid,text) to authenticated;
notify pgrst,'reload schema';
