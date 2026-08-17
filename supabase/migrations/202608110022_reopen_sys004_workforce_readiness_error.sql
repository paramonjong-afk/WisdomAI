-- Reopen the existing SYS-004 item for the deduplicated Workforce readiness incident.
update public.system_work_items
set status='ready',
    progress=0,
    risk='high',
    current_step='approved_workforce_readiness_repair',
    production_status='approved_for_execution',
    evidence=concat_ws(E'\n',nullif(evidence,''),'11/8/2569: พบ Health Monitor แสดง [object Object] เพราะ employee_onboarding_readiness ยังไม่มี company_id; ผู้ใช้อนุมัติ Migration ซ่อม Tenant View และ Deploy health-monitor.'),
    error_fingerprint='health_monitor.employee_readiness.company_id_missing',
    worker_id=null,
    heartbeat_at=null,
    lease_expires_at=null,
    updated_at=now()
where work_key='SYS-004';
