-- SYS-004: persist the current grouped error fingerprint on the authoritative work item.
alter table public.system_work_items
  add column if not exists error_fingerprint text;

create index if not exists system_work_items_error_fingerprint_idx
  on public.system_work_items(error_fingerprint)
  where error_fingerprint is not null;

comment on column public.system_work_items.error_fingerprint is
  'Stable grouped fingerprint of the latest monitored errors; never contains secrets or tokens.';

notify pgrst,'reload schema';
