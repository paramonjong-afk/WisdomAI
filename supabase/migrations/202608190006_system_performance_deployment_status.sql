-- Record the real rollout state. Database policy is live; the web release waits
-- for Vercel team access and must not be reported as production-deployed early.
update public.system_work_items
set status='blocked',progress=65,risk='medium',production_status='database_deployed_web_deploy_blocked',
    current_step='Vercel deployment requires membership of team_Suu3ctncgnzfAuosKYJYOY6s for the currently linked project.',
    evidence=coalesce(evidence,'') || ' Migration 202608190005 is applied remotely. Build and all script tests passed; Vercel production deploy was rejected as Not authorized for the current CLI account.',
    updated_at=now()
where work_key='SYS-PERF-001';
