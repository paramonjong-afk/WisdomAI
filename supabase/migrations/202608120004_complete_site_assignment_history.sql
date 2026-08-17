update public.system_work_items set status='done',progress=100,current_step='completed',
  production_status='deployed_migration_function_frontend_smoke_passed',
  detail='Effective-dated multi-site assignments, assignment/employee/site policy precedence, tenant-scoped readiness and immutable attendance policy snapshots are active.',
  evidence='Migration 202608120003 applied; attendance-clock and Vercel Production deployed; regression/lint/build passed; Employees, Workforce Setup and Time Tracking HTTP 200; unauthenticated attendance-clock HTTP 401.',
  worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
where work_key='WORKFORCE-SITE-POLICY-001';
