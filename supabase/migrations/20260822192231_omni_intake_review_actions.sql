-- OMNI-INTAKE-002: Messages remain in the central source register and are
-- explicitly reviewable from Intake without turning every conversation into a document.
alter table public.omni_intake_sources
  add column if not exists review_decision text not null default 'pending',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists review_note text;

alter table public.omni_intake_sources
  drop constraint if exists omni_intake_sources_review_decision_check;
alter table public.omni_intake_sources
  add constraint omni_intake_sources_review_decision_check
  check (review_decision in ('pending','approved','rejected'));

create index if not exists omni_intake_sources_review_queue_idx
  on public.omni_intake_sources (company_id, review_decision, occurred_at desc);

create table if not exists public.omni_intake_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_id uuid not null references public.omni_intake_sources(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected')),
  note text,
  actor_id uuid references public.profiles(id) on delete set null,
  event_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists omni_intake_review_events_source_idx
  on public.omni_intake_review_events (source_id, created_at desc);

alter table public.omni_intake_review_events enable row level security;
drop policy if exists "Managers read omni intake reviews" on public.omni_intake_review_events;
create policy "Managers read omni intake reviews" on public.omni_intake_review_events
for select to authenticated using (
  company_id=public.current_company_id() and public.is_company_manager(company_id)
);
revoke all on public.omni_intake_review_events from anon, authenticated;
grant select on public.omni_intake_review_events to authenticated;

create or replace function public.review_omni_intake_source(
  target_source_id uuid,
  target_decision text,
  target_note text default null
)
returns public.omni_intake_sources
language plpgsql security definer set search_path=public as $$
declare source_row public.omni_intake_sources; actor uuid:=auth.uid(); result public.omni_intake_sources;
begin
  if target_decision not in ('approved','rejected') then raise exception 'omni_intake_review_decision_invalid'; end if;
  select * into source_row from public.omni_intake_sources where id=target_source_id for update;
  if source_row.id is null then raise exception 'omni_intake_source_not_found'; end if;
  if not public.is_company_manager(source_row.company_id) then raise exception 'omni_intake_review_permission_denied'; end if;

  update public.omni_intake_sources set
    review_decision=target_decision,
    reviewed_at=now(),
    reviewed_by=actor,
    review_note=nullif(btrim(coalesce(target_note,'')),''),
    filter_status=case when target_decision='approved' then 'confirmed' else 'dismissed' end
  where id=source_row.id returning * into result;

  if target_decision='approved' then
    update public.omni_filter_tasks set task_status='confirmed', version=version+1, updated_at=now()
    where source_id=source_row.id and task_status in ('queued','claimed');
  else
    update public.omni_filter_tasks set task_status='cancelled', version=version+1, updated_at=now()
    where source_id=source_row.id and task_status not in ('completed','cancelled');
  end if;

  insert into public.omni_intake_review_events(company_id,source_id,decision,note,actor_id,event_key)
  values(source_row.company_id,source_row.id,target_decision,nullif(btrim(coalesce(target_note,'')),''),actor,
    'omni-review:'||source_row.id::text||':'||target_decision||':'||extract(epoch from now())::bigint::text);
  return result;
end;
$$;

revoke all on function public.review_omni_intake_source(uuid,text,text) from public, anon;
grant execute on function public.review_omni_intake_source(uuid,text,text) to authenticated;
comment on table public.omni_intake_review_events is 'Immutable audit trail for Admin approval or rejection of a LINE/Web Chat Intake source.';
notify pgrst, 'reload schema';
