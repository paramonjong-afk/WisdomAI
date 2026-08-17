update public.system_work_items set
  status='review',progress=95,current_step='authenticated_two_company_uat',
  production_status='migration_edge_frontend_deployed_uat_pending',
  evidence='TEN-010: company/global scope migration applied; health-monitor and System Health UI deployed. Tenant/static tests, warning and Telegram dedupe regressions, lint and build passed; /system-health HTTP 200 and anonymous health-monitor HTTP 401. Awaiting authenticated two-company isolation and Telegram destination UAT.',
  worker_id=null,heartbeat_at=null,lease_expires_at=null,updated_at=now()
where work_key='TEN-010';
