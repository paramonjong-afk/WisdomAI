-- Reconcile the two historical SYS-004 repair children after PR #96 and
-- Production revision 601ddf7 proved the monitoring-sentinel replacement.
-- History is retained in system_work_item_events; no incident is deleted.
with resolved(work_key, resolution) as (
  values
    ('SYS-004-ORPHAN-CLAIM-ROOTCAUSE-001'::text, 'superseded_by_pr96_monitoring_sentinel_hardening'::text),
    ('SYS-004-RECOVERY-001'::text, 'completed_by_pr96_monitoring_sentinel_hardening'::text)
)
update public.system_work_items item
set status='done', progress=100, control_state='done',
    production_status='reconciled_production_verified',
    worker_id=null, heartbeat_at=null, lease_expires_at=null,
    worker_outcome='completed', worker_outcome_reason='PR #96 merged as 601ddf77; Cloudflare revision 601ddf7; SYS-004 is a healthy monitoring_sentinel with no Worker claim.',
    worker_outcome_at=now(), current_step='reconciled_by_controller',
    context_manifest=coalesce(item.context_manifest,'{}'::jsonb)||jsonb_build_object(
      'reconciled_by','CTRL-CONTROL-ROUND-20260916',
      'resolution',resolved.resolution,
      'production_revision','601ddf7',
      'source_pr',96),
    evidence=left(concat_ws(E'\n',nullif(item.evidence,''),'CTRL-CONTROL-ROUND-20260916: PR #96 / main 601ddf77 / Cloudflare 601ddf7 verified; historical SYS-004 repair child reconciled without deleting audit history.'),4000),
    updated_at=now()
from resolved
where item.work_key=resolved.work_key
  and item.status<>'done'
  and item.worker_id is null;

update public.system_work_dispatch_intents intent
set status='completed', updated_at=now()
where intent.work_key in ('SYS-004-ORPHAN-CLAIM-ROOTCAUSE-001','SYS-004-RECOVERY-001')
  and intent.status='pending'
  and exists (select 1 from public.system_work_items item where item.work_key=intent.work_key and item.status='done');
