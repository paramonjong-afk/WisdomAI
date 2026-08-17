-- Record authenticated production UAT for the automation worker and local runner.
update public.system_work_items
set status='done',progress=100,
    evidence='9/8/2569: Production secret authentication passed; claim ambiguity fixed by 202608090016; atomic claim/finish succeeded and Windows Scheduled Task returned result 0.',
    production_status='deployed_and_authenticated_uat_passed',
    worker_id=null,heartbeat_at=null,lease_expires_at=null,current_step=null,updated_at=now()
where work_key='SYS-010';

insert into public.system_work_items(work_key,title,category,status,progress,risk,detail,evidence,production_status)
values(
  'SYS-011','Local Codex Automation Runner','automation','done',100,'high',
  'Codex CLI local runner with encrypted Windows credential, single-instance lock, five-minute Scheduled Task, heartbeat, safe-task execution and approval preflight.',
  '9/8/2569: Codex CLI login verified outside sandbox; Automation Worker secret synchronized; credential encrypted for current Windows user; task WisdomAI Local Automation Runner installed; authenticated status passed; first successful post-fix run returned task result 0.',
  'local_task_active_production_worker_authenticated'
)
on conflict(work_key) do update set
  title=excluded.title,category=excluded.category,status=excluded.status,progress=excluded.progress,
  risk=excluded.risk,detail=excluded.detail,evidence=excluded.evidence,
  production_status=excluded.production_status,worker_id=null,heartbeat_at=null,
  lease_expires_at=null,current_step=null,updated_at=now();
