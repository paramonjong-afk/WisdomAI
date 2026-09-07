begin;

create or replace function public.recover_stale_line_ingestion_events(
  target_age_minutes integer default 15,
  target_limit integer default 500,
  target_company_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  recovered integer := 0;
begin
  if target_age_minutes < 15 or target_age_minutes > 1440 then
    raise exception 'invalid_line_recovery_age';
  end if;
  if target_limit < 1 or target_limit > 2000 then
    raise exception 'invalid_line_recovery_limit';
  end if;

  with stale as (
    select id
    from public.line_ingestion_events
    where processing_status in ('received', 'processing')
      and processed_at is null
      and received_at < now() - make_interval(mins => target_age_minutes)
      and (target_company_id is null or company_id = target_company_id)
    order by received_at
    for update skip locked
    limit target_limit
  )
  update public.line_ingestion_events event
  set processing_status = 'failed',
      processing_stage = 'stale_recovered',
      processed_at = coalesce(event.processed_at, now()),
      error_message = left(concat_ws(E'\n', nullif(event.error_message, ''),
        'LINE ingestion recovered after exceeding the processing SLA; raw message and attachments were retained for review.'), 1000),
      updated_at = now()
  from stale
  where event.id = stale.id;

  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

revoke all on function public.recover_stale_line_ingestion_events(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.recover_stale_line_ingestion_events(integer, integer, uuid) to service_role;

comment on function public.recover_stale_line_ingestion_events(integer, integer, uuid) is
  'Marks orphaned LINE ingestion attempts as failed after the SLA, retaining raw evidence and limiting each recovery batch.';

commit;
