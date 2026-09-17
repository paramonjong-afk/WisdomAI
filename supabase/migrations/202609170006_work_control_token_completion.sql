-- WORK-CONTROL-CORE-V3-TOKEN-COMPLETION
-- Additive only: canonical summary/delta telemetry and exact-input cache lifecycle.

alter table public.system_work_items
  add column if not exists source_of_truth_summary text,
  add column if not exists task_packet_version text not null default 'compact-v1',
  add column if not exists last_report_hash text,
  add column if not exists last_reported_at timestamptz;

alter table public.system_worker_runs
  add column if not exists report_hash text,
  add column if not exists report_changed boolean not null default true;

create or replace function public.touch_system_work_cache_v1(target_cache_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.system_work_result_cache
  set last_hit_at=now(),hit_count=hit_count+1
  where cache_key=target_cache_key and (valid_until is null or valid_until>now());
  return found;
end $$;

revoke all on function public.touch_system_work_cache_v1(text) from public,anon,authenticated;
grant execute on function public.touch_system_work_cache_v1(text) to service_role;

create or replace function public.record_system_work_report_delta_v1(
  target_run uuid,target_worker text,target_report_hash text
) returns boolean language plpgsql security definer set search_path=public as $$
declare target_key text; prior_hash text; changed boolean;
begin
  if nullif(trim(target_report_hash),'') is null then return false; end if;
  select r.work_key into target_key from public.system_worker_runs r
  where r.id=target_run and r.worker_id=target_worker;
  if target_key is null then return false; end if;
  select last_report_hash into prior_hash from public.system_work_items where work_key=target_key for update;
  changed:=prior_hash is distinct from trim(target_report_hash);
  update public.system_worker_runs set report_hash=trim(target_report_hash),report_changed=changed where id=target_run;
  update public.system_work_items set last_report_hash=trim(target_report_hash),
    last_reported_at=case when changed then now() else last_reported_at end where work_key=target_key;
  return changed;
end $$;

revoke all on function public.record_system_work_report_delta_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_system_work_report_delta_v1(uuid,text,text) to service_role;

comment on column public.system_work_items.source_of_truth_summary is
  'Controller-owned compact requirement summary. Worker packets use this instead of chat history.';
comment on column public.system_work_items.last_report_hash is
  'Hash of the last material Worker report; identical reports are retained in run audit but suppressed as unchanged deltas.';

notify pgrst,'reload schema';
