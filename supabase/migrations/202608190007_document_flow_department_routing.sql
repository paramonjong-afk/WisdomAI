-- Document Flow rooms share one ledger item.  Department routing never creates
-- another Intake ID; it only changes the workflow state and appends an event.
alter table public.document_flow_items
  add column if not exists target_department text,
  add column if not exists candidate_departments text[] not null default '{}',
  add column if not exists assignment_status text not null default 'unassigned'
    check (assignment_status in ('unassigned','candidate_review','claimed','in_progress','returned','completed')),
  add column if not exists sensitivity text not null default 'general'
    check (sensitivity in ('general','financial','restricted_hr')),
  add column if not exists classification_note text;

create index if not exists document_flow_items_company_department_queue_idx
  on public.document_flow_items(company_id,target_department,assignment_status,updated_at desc);

create table if not exists public.document_flow_department_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  department text not null check (department in ('accounting','procurement','inventory','hr','project','admin')),
  created_at timestamptz not null default now(),
  primary key(company_id,profile_id,department)
);

alter table public.document_flow_department_members enable row level security;
drop policy if exists "Department members read own membership" on public.document_flow_department_members;
create policy "Department members read own membership" on public.document_flow_department_members
for select to authenticated using (
  profile_id=auth.uid() or public.is_platform_admin() or public.is_company_manager(company_id)
);
revoke all on public.document_flow_department_members from anon,authenticated;
grant select on public.document_flow_department_members to authenticated;

create or replace function public.is_document_flow_department_member(target_company_id uuid, target_department text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin()
    or public.is_company_manager(target_company_id)
    or exists(select 1 from public.document_flow_department_members member
      where member.company_id=target_company_id and member.profile_id=auth.uid() and member.department=target_department);
$$;

create or replace function public.can_read_document_flow_item(
  target_company_id uuid, target_department text, target_candidates text[], target_sensitivity text
) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or public.is_company_manager(target_company_id)
    or (
      coalesce(target_sensitivity,'general')='general'
      and exists(select 1 from public.document_flow_department_members member
        where member.company_id=target_company_id and member.profile_id=auth.uid()
          and (member.department=target_department or member.department=any(coalesce(target_candidates,'{}'::text[]))))
    )
    or (
      coalesce(target_sensitivity,'general')<>'general'
      and exists(select 1 from public.document_flow_department_members member
        where member.company_id=target_company_id and member.profile_id=auth.uid() and member.department=target_department)
    );
$$;

drop policy if exists "Managers read document flow items" on public.document_flow_items;
create policy "Authorized departments read document flow items" on public.document_flow_items
for select to authenticated using (
  company_id=public.current_company_id()
  and public.can_read_document_flow_item(company_id,target_department,candidate_departments,sensitivity)
);
drop policy if exists "Managers read document flow events" on public.document_flow_events;
create policy "Authorized departments read document flow events" on public.document_flow_events
for select to authenticated using (
  company_id=public.current_company_id() and exists(
    select 1 from public.document_flow_items item where item.id=document_flow_events.item_id
      and public.can_read_document_flow_item(item.company_id,item.target_department,item.candidate_departments,item.sensitivity)
  )
);

create or replace function public.document_flow_department_for_route(target_route text)
returns text language sql immutable as $$
  select case
    when target_route in ('accounts_payable_tax','billing_match','payment_verification') then 'accounting'
    when target_route in ('procurement_price_reference','purchase_order') then 'procurement'
    when target_route in ('goods_receipt_stock') then 'inventory'
    when target_route in ('hr_initial_review') then 'hr'
    when target_route like 'project%' then 'project'
    else 'admin'
  end;
$$;

update public.document_flow_items
set target_department=coalesce(target_department,public.document_flow_department_for_route(route_target)),
    sensitivity=case when route_target='hr_initial_review' then 'restricted_hr' else sensitivity end,
    candidate_departments=case when cardinality(candidate_departments)>0 then candidate_departments else array[public.document_flow_department_for_route(route_target)] end;

create or replace function public.route_document_flow_item(
  target_item_id uuid,
  target_action text,
  target_expected_version integer,
  target_event_key text,
  target_note text default null,
  target_document_type text default null,
  target_department text default null,
  target_candidates text[] default null
) returns public.document_flow_items
language plpgsql security definer set search_path=public as $$
declare before_row public.document_flow_items; result_row public.document_flow_items;
  next_flow text; next_state text; next_room text; next_department text; next_candidates text[];
  next_assignment text; next_sensitivity text;
begin
  if coalesce(trim(target_event_key),'')='' then raise exception 'workflow_event_key_required'; end if;
  select item.* into before_row from public.document_flow_items item
    join public.document_flow_events event on event.item_id=item.id where event.event_key=target_event_key limit 1;
  if before_row.id is not null then return before_row; end if;
  select * into before_row from public.document_flow_items where id=target_item_id for update;
  if before_row.id is null then raise exception 'workflow_item_not_found'; end if;
  if before_row.version<>target_expected_version then raise exception 'workflow_version_conflict'; end if;
  if before_row.company_id<>public.current_company_id() and not public.is_platform_admin() then raise exception 'workflow_permission_denied'; end if;

  next_flow:=before_row.current_flow; next_state:=before_row.state; next_room:=before_row.current_room;
  next_department:=coalesce(nullif(trim(target_department),''),before_row.target_department,public.document_flow_department_for_route(before_row.route_target));
  next_candidates:=coalesce(nullif(target_candidates,'{}'::text[]),before_row.candidate_departments,array[next_department]);
  next_assignment:=before_row.assignment_status; next_sensitivity:=before_row.sensitivity;

  if target_action='claim_destination' then
    if not public.is_document_flow_department_member(before_row.company_id,next_department) then raise exception 'workflow_department_permission_denied'; end if;
    if before_row.assignment_status not in ('unassigned','candidate_review','returned') then raise exception 'workflow_item_already_claimed'; end if;
    if before_row.sensitivity<>'general' and not public.is_document_flow_department_member(before_row.company_id,before_row.target_department) then raise exception 'workflow_sensitive_permission_denied'; end if;
    next_flow:='posting'; next_state:='posting'; next_room:='destination_'||next_department||'_active'; next_assignment:='claimed'; next_candidates:=array[next_department];
  else
    if not public.is_platform_admin() and not public.is_company_manager(before_row.company_id) then raise exception 'workflow_permission_denied'; end if;
    case target_action
      when 'classify_and_route' then
        if before_row.current_flow<>'filter' then raise exception 'workflow_transition_not_allowed'; end if;
        if next_department='hr' then next_sensitivity:='restricted_hr'; end if;
        next_flow:='posting'; next_state:='awaiting_approval'; next_room:='destination_'||next_department||'_queue';
        next_assignment:=case when cardinality(next_candidates)>1 then 'candidate_review' else 'unassigned' end;
      when 'return_to_filter' then
        if coalesce(trim(target_note),'')='' then raise exception 'workflow_note_required'; end if;
        next_flow:='filter'; next_state:='needs_correction'; next_room:='filter_correction_room'; next_assignment:='returned';
      when 'return_to_intake' then
        if coalesce(trim(target_note),'')='' then raise exception 'workflow_note_required'; end if;
        next_flow:='intake'; next_state:='awaiting_classification'; next_room:='intake_manual_review'; next_assignment:='returned';
      when 'reassign_destination' then
        if coalesce(trim(target_note),'')='' then raise exception 'workflow_note_required'; end if;
        next_room:='destination_'||next_department||'_queue'; next_state:='awaiting_approval'; next_assignment:=case when cardinality(next_candidates)>1 then 'candidate_review' else 'unassigned' end;
      else raise exception 'workflow_action_unknown';
    end case;
  end if;
  update public.document_flow_items set
    current_flow=next_flow,state=next_state,current_room=next_room,
    document_type=coalesce(nullif(trim(target_document_type),''),document_type),
    target_department=next_department,candidate_departments=next_candidates,assignment_status=next_assignment,
    sensitivity=next_sensitivity,classification_note=coalesce(nullif(trim(target_note),''),classification_note),
    assigned_to=case when target_action='claim_destination' then auth.uid() when target_action in ('return_to_filter','return_to_intake','reassign_destination') then null else assigned_to end,
    version=version+1,updated_at=now()
  where id=before_row.id returning * into result_row;
  insert into public.document_flow_events(item_id,company_id,event_key,event_type,from_flow,to_flow,from_state,to_state,from_room,to_room,note,payload,actor_id)
  values(result_row.id,result_row.company_id,target_event_key,target_action,before_row.current_flow,result_row.current_flow,before_row.state,result_row.state,before_row.current_room,result_row.current_room,target_note,
    jsonb_build_object('expected_version',target_expected_version,'result_version',result_row.version,'department',result_row.target_department,'candidates',result_row.candidate_departments,'assignment_status',result_row.assignment_status,'sensitivity',result_row.sensitivity),auth.uid());
  return result_row;
end;
$$;

revoke all on function public.is_document_flow_department_member(uuid,text),public.can_read_document_flow_item(uuid,text,text[],text),public.document_flow_department_for_route(text),public.route_document_flow_item(uuid,text,integer,text,text,text,text,text[]) from public,anon;
grant execute on function public.route_document_flow_item(uuid,text,integer,text,text,text,text,text[]) to authenticated;
grant execute on function public.is_document_flow_department_member(uuid,text),public.can_read_document_flow_item(uuid,text,text[],text),public.document_flow_department_for_route(text) to authenticated;
