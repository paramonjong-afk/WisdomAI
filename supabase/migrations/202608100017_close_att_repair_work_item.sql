-- Reconcile ATT-REPAIR-001 after the manager completed Production UAT.
update public.system_work_items
set status='done',progress=100,
  evidence='Migration 202608100016 and Reports deployment passed; manager confirmed all attendance repair data was corrected and approved closing UAT.',
  production_status='deployed_uat_passed',updated_at=now()
where work_key='ATT-REPAIR-001';

notify pgrst,'reload schema';
