update public.system_work_items set
  status='done',progress=100,current_step='completed',
  production_status='migration_edge_frontend_deployed_smoke_passed',
  evidence='TEN-007: employment records now use (company_id, profile_id); Employee, Reports, Workforce Setup and Project Controls scope employment reads/writes to the active company; create-employee uses the composite conflict target. Tenant regressions, lint and build passed; Production pages returned HTTP 200 and anonymous create-employee returned HTTP 401.',
  worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
where work_key='TEN-007';
