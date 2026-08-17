-- SYS-010 deployed; authenticated production UAT remains pending.
update public.system_work_items set
  status='review',
  progress=90,
  production_status='deployed_pending_authenticated_uat',
  evidence='Migration 202608090014 and automation-worker deployed; lint, build, Deno check and dry-run passed; unauthenticated smoke returned HTTP 401; authenticated smoke pending without rotating an active credential.',
  worker_id=null,
  heartbeat_at=null,
  lease_expires_at=null,
  current_step=null,
  updated_at=now()
where work_key='SYS-010';
